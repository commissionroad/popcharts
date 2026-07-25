import {
  completeSetBinaryMarketAbi,
  POSTGRAD_MARKET_STATUS,
  SIDE_NO,
  SIDE_YES,
} from "@popcharts/protocol";
import type { Hash } from "viem";
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
 * Contract statuses that already carry a resolution outcome, so the runner has
 * nothing left to write: another actor proposed first (`ResolutionPending`), a
 * proposal is under adjudication (`Disputed`), or the market already settled
 * (`Resolved`).
 */
const RESOLUTION_ALREADY_ON_CHAIN_STATUSES: ReadonlySet<number> = new Set([
  POSTGRAD_MARKET_STATUS.resolutionPending,
  POSTGRAD_MARKET_STATUS.disputed,
  POSTGRAD_MARKET_STATUS.resolved,
]);

export type ResolutionChainAction = { side: typeof SIDE_YES | typeof SIDE_NO };

export type MarketResolutionProposalResult = {
  blockTimestamp: Date;
  kind: "already_on_chain" | "proposed";
  transactionHash?: Hash;
};

export type MarketResolutionProposalDependencies = {
  currentChainId: () => number;
  getLatestBlockTimestamp: () => Promise<Date>;
  readMarketStatus: (marketAddress: `0x${string}`) => Promise<number>;
  submitResolutionProposal: (
    marketAddress: `0x${string}`,
    side: number,
  ) => Promise<Hash>;
  waitForTransactionTimestamp: (transactionHash: Hash) => Promise<Date>;
};

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
 * Guarded by the on-chain status: only a market still in `Trading` is proposed
 * on, and any status that already carries a resolution outcome is a no-op
 * success rather than an error — a permissionless dispute window means other
 * actors move the market too. The DB audit row is written by the caller only
 * after this succeeds.
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

  const currentStatus = await dependencies.readMarketStatus(
    postgradMarketAddress,
  );
  if (RESOLUTION_ALREADY_ON_CHAIN_STATUSES.has(currentStatus)) {
    return {
      blockTimestamp: await dependencies.getLatestBlockTimestamp(),
      kind: "already_on_chain",
    };
  }

  if (currentStatus !== POSTGRAD_MARKET_STATUS.trading) {
    throw new Error(
      `Postgrad market ${postgradMarketAddress} has contract status ${currentStatus}; expected ${POSTGRAD_MARKET_STATUS.trading} (Trading) before a resolution proposal.`,
    );
  }

  const transactionHash = await dependencies.submitResolutionProposal(
    postgradMarketAddress,
    action.side,
  );

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
    getLatestBlockTimestamp: async () => {
      const block = await publicClient.getBlock();

      return new Date(Number(block.timestamp) * 1000);
    },
    readMarketStatus: async (marketAddress) => {
      const status = await publicClient.readContract({
        abi: completeSetBinaryMarketAbi,
        address: marketAddress,
        functionName: "status",
      });

      return Number(status);
    },
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
