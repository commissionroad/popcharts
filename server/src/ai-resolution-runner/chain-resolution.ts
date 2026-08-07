import {
  completeSetBinaryMarketAbi,
  POSTGRAD_MARKET_STATUS,
  SIDE_NO,
  SIDE_YES,
} from "@popcharts/protocol";
import { type BaseError, ContractFunctionRevertedError, type Hash } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  createReadOnlyClient,
  createWalletClient,
} from "src/blockchain/client";
import { config } from "src/config";

import type { ResolutionVerdict } from "../ai-resolution/types";

const DEFAULT_LOCAL_RESOLVER_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
/**
 * Contract statuses that already carry a resolution outcome, so there is
 * nothing left to propose: a proposal is pending (`ResolutionPending`), under
 * adjudication (`Disputed`), or the market already settled (`Resolved`).
 *
 * Read out of the revert rather than checked beforehand — see
 * {@link isAlreadyProposedRevert}. Every other non-`Trading` status, `Cancelled`
 * above all, is a genuine failure and must not be mistaken for one of these.
 */
const RESOLUTION_ALREADY_ON_CHAIN_STATUSES: ReadonlySet<number> = new Set([
  POSTGRAD_MARKET_STATUS.resolutionPending,
  POSTGRAD_MARKET_STATUS.disputed,
  POSTGRAD_MARKET_STATUS.resolved,
]);

/** The contract-encoded side a verdict resolves to, per MarketTypes.Side. */
export type ResolutionChainAction = { side: typeof SIDE_YES | typeof SIDE_NO };

/**
 * What one propose attempt achieved. `already_proposed` is a success, not a
 * failure: the market carries a proposal, which is all the runner needed. It
 * carries no timestamp because the runner does not record one — the indexer
 * stamps `resolved_at` from the confirming event (ADR 0026).
 */
export type MarketResolutionProposalResult =
  | { blockTimestamp: Date; kind: "proposed"; transactionHash: Hash }
  | { kind: "already_proposed" };

export type MarketResolutionProposalDependencies = {
  currentChainId: () => number;
  submitResolutionProposal: (
    marketAddress: `0x${string}`,
    side: number,
  ) => Promise<Hash>;
  waitForTransactionTimestamp: (transactionHash: Hash) => Promise<Date>;
};

/**
 * Whether a failed `proposeResolution` failed because the market already
 * carries a proposal.
 *
 * `proposeResolution` opens with `_requireStatus(Status.Trading)` and reverts
 * `InvalidStatus(actual, expected)` for every other status, so the revert is
 * the authoritative answer to "did someone already propose" — no pre-flight
 * read can be, because the chain moves between the read and the write.
 *
 * `actual` decides it. `ResolutionPending`/`Disputed`/`Resolved` mean the work
 * is done; `Cancelled` reverts through the same error and is a real failure the
 * runner must not swallow.
 */
export function isAlreadyProposedRevert(error: unknown): boolean {
  const reverted = (error as BaseError | undefined)?.walk?.(
    (candidate) => candidate instanceof ContractFunctionRevertedError,
  );
  if (!(reverted instanceof ContractFunctionRevertedError)) {
    return false;
  }

  if (reverted.data?.errorName !== "InvalidStatus") {
    return false;
  }

  const [actual] = reverted.data.args ?? [];
  return RESOLUTION_ALREADY_ON_CHAIN_STATUSES.has(Number(actual));
}

/**
 * Maps an auto-resolvable verdict to the winning side. Returns null for every
 * verdict the runner must NOT submit on-chain: draws park for an operator
 * (`cancel_draw`), `too_early` re-queues, and `manual_review` waits for a human.
 */
export function resolutionChainAction(
  verdict: ResolutionVerdict,
): ResolutionChainAction | null {
  if (verdict === "resolve_yes") {
    return { side: SIDE_YES };
  }

  if (verdict === "resolve_no") {
    return { side: SIDE_NO };
  }

  return null;
}

/**
 * Proposes the resolution on the market's own CompleteSetBinaryMarket contract
 * (address per market), which opens the public dispute window. Proposing — not
 * resolving — is the runner's last on-chain act: an undisputed proposal is
 * finalized by the keeper once the window closes, and a disputed one is settled
 * by an operator (repo ADR 0024, protocol ADR 0013). This holds even where the
 * window is configured to zero: the proposal is finalizable immediately, but
 * something still has to call `finalizeResolution`.
 *
 * Not guarded by a pre-flight status read (ADR 0026). The contract refuses a
 * second proposal itself — `_requireStatus(Status.Trading)` — so a read could
 * only predict an answer the write already gives, and would still be racing the
 * chain between the two calls. A revert that means "already proposed" is
 * translated into a success here; anything else propagates, `Cancelled`
 * included.
 *
 * The decode depends on the revert reaching us with ABI context, which is the
 * usual shape: `writeContract` estimates gas first, the estimate reverts, and
 * viem wraps the decoded `ContractFunctionRevertedError` as a cause. If a
 * provider instead broadcasts and the transaction reverts on-chain, that
 * surfaces from `waitForTransactionTimestamp` as an ordinary failure and the
 * job retries — noisier, never silently wrong. Worth confirming against a real
 * node before relying on the cheap path.
 *
 * The caller has already committed its `pending` audit row before calling this.
 */
export async function proposeMarketResolutionOnChain(
  {
    chainId,
    postgradMarketAddress,
    verdict,
  }: {
    chainId: number;
    postgradMarketAddress: `0x${string}`;
    verdict: ResolutionVerdict;
  },
  dependencies: MarketResolutionProposalDependencies = createDefaultDependencies(),
): Promise<MarketResolutionProposalResult | null> {
  const action = resolutionChainAction(verdict);
  if (!action) {
    return null;
  }

  const currentChainId = dependencies.currentChainId();
  if (chainId !== currentChainId) {
    throw new Error(
      `Resolution job chain ${chainId} does not match configured chain ${currentChainId}.`,
    );
  }

  let transactionHash: Hash;
  try {
    transactionHash = await dependencies.submitResolutionProposal(
      postgradMarketAddress,
      action.side,
    );
  } catch (error) {
    if (isAlreadyProposedRevert(error)) {
      return { kind: "already_proposed" };
    }
    throw error;
  }

  return {
    blockTimestamp:
      await dependencies.waitForTransactionTimestamp(transactionHash),
    kind: "proposed",
    transactionHash,
  };
}

export function readResolverPrivateKey(
  env: Record<string, string | undefined> = process.env,
  networkName = config.name,
): `0x${string}` {
  const value =
    env.POPCHARTS_RESOLVER_PRIVATE_KEY ??
    env.POPCHARTS_DEVCHAIN_PRIVATE_KEY ??
    env.POPCHARTS_DEPLOYER_PRIVATE_KEY ??
    (networkName === "local" ? DEFAULT_LOCAL_RESOLVER_PRIVATE_KEY : undefined);

  if (!value) {
    throw new Error(
      "A resolver private key is required for market resolution transitions.",
    );
  }

  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("The resolver private key must be a 32-byte hex key.");
  }

  return value as `0x${string}`;
}

function createDefaultDependencies(): MarketResolutionProposalDependencies {
  const publicClient = createReadOnlyClient();
  const account = privateKeyToAccount(readResolverPrivateKey());
  const walletClient = createWalletClient(account);

  return {
    currentChainId: () => config.chainId,
    submitResolutionProposal: async (marketAddress, side) =>
      walletClient.writeContract({
        abi: completeSetBinaryMarketAbi,
        address: marketAddress,
        functionName: "proposeResolution",
        args: [side],
      }),
    waitForTransactionTimestamp: async (transactionHash) => {
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: transactionHash,
      });

      if (receipt.status !== "success") {
        throw new Error(
          `Resolution proposal transaction failed: ${transactionHash}`,
        );
      }

      const block = await publicClient.getBlock({
        blockNumber: receipt.blockNumber,
      });

      return new Date(Number(block.timestamp) * 1000);
    },
  };
}
