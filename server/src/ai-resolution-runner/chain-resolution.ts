import {
  completeSetBinaryMarketAbi,
  contractSideToMarketSide,
  type MarketSide,
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
 * nothing left to *propose*: another actor proposed first (`ResolutionPending`),
 * a proposal is under adjudication (`Disputed`), or the market already settled
 * (`Resolved`). It may still owe the audit row explaining that proposal — the
 * two are separate obligations, and conflating them is what once lost the row.
 */
const RESOLUTION_ALREADY_ON_CHAIN_STATUSES: ReadonlySet<number> = new Set([
  POSTGRAD_MARKET_STATUS.resolutionPending,
  POSTGRAD_MARKET_STATUS.disputed,
  POSTGRAD_MARKET_STATUS.resolved,
]);

/** The contract-encoded side a verdict resolves to, per MarketTypes.Side. */
export type ResolutionChainAction = { side: typeof SIDE_YES | typeof SIDE_NO };

/**
 * A resolution proposal that already exists on the market contract. The side is
 * read back from the contract rather than remembered, so callers can reconcile
 * an off-chain verdict against the one the chain actually carries.
 */
export type OnChainResolutionProposal = {
  blockTimestamp: Date;
  proposedSide: MarketSide;
};

/**
 * The outcome of one propose attempt. `proposedSide` is always the side the
 * chain holds afterwards — the side just submitted (`proposed`), or the side
 * read back off the contract (`already_on_chain`). It is never the caller's
 * expectation, which is the whole point: those two can disagree.
 */
export type MarketResolutionProposalResult = OnChainResolutionProposal & {
  kind: "already_on_chain" | "proposed";
  transactionHash?: Hash;
};

/**
 * The read half of the chain surface. Split out so the audit-only path — which
 * must never be able to submit a transaction — can be wired with reads alone,
 * and so it does not require a resolver private key to exist.
 */
export type MarketResolutionReadDependencies = {
  currentChainId: () => number;
  getLatestBlockTimestamp: () => Promise<Date>;
  readMarketStatus: (marketAddress: `0x${string}`) => Promise<number>;
  readProposedSide: (marketAddress: `0x${string}`) => Promise<number>;
};

/**
 * The full chain surface a propose attempt needs: the reads above plus the two
 * write steps. Injectable so tests drive the whole path without a chain.
 */
export type MarketResolutionProposalDependencies =
  MarketResolutionReadDependencies & {
    submitResolutionProposal: (
      marketAddress: `0x${string}`,
      side: number,
    ) => Promise<Hash>;
    waitForTransactionTimestamp: (transactionHash: Hash) => Promise<Date>;
  };

/**
 * The verdict a side already on-chain implies. The inverse of
 * {@link resolutionChainAction}, used to write down what the chain actually did
 * rather than what a later model run would have done.
 */
export function chainSideVerdict(side: MarketSide): ResolutionVerdict {
  return side === "yes" ? "resolve_yes" : "resolve_no";
}

/**
 * Reads the resolution proposal a market already carries, or null when the
 * contract holds none. Read-only by construction: it cannot reach
 * `proposeResolution`, which is what makes it safe to call on a market the
 * runner has been told to stand down from.
 */
export async function readOnChainResolutionProposal(
  {
    chainId,
    postgradMarketAddress,
  }: {
    chainId: number;
    postgradMarketAddress: `0x${string}`;
  },
  dependencies: MarketResolutionReadDependencies = createReadDependencies(),
): Promise<OnChainResolutionProposal | null> {
  const currentChainId = dependencies.currentChainId();
  if (chainId !== currentChainId) {
    throw new Error(
      `Resolution job chain ${chainId} does not match configured chain ${currentChainId}.`,
    );
  }

  return await readProposalAtStatus(
    await dependencies.readMarketStatus(postgradMarketAddress),
    postgradMarketAddress,
    dependencies,
  );
}

/**
 * Shared tail of both chain reads: turns an already-fetched contract status into
 * the proposal it carries, so the propose path does not pay for a second
 * `status()` round trip to reuse this logic.
 */
async function readProposalAtStatus(
  currentStatus: number,
  postgradMarketAddress: `0x${string}`,
  dependencies: MarketResolutionReadDependencies,
): Promise<OnChainResolutionProposal | null> {
  if (!RESOLUTION_ALREADY_ON_CHAIN_STATUSES.has(currentStatus)) {
    return null;
  }

  const [blockTimestamp, side] = await Promise.all([
    dependencies.getLatestBlockTimestamp(),
    dependencies.readProposedSide(postgradMarketAddress),
  ]);

  return { blockTimestamp, proposedSide: contractSideToMarketSide(side) };
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

  const existing = await readProposalAtStatus(
    currentStatus,
    postgradMarketAddress,
    dependencies,
  );
  if (existing) {
    return { ...existing, kind: "already_on_chain" };
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
    proposedSide: contractSideToMarketSide(action.side),
    transactionHash,
  };
}

/**
 * The key the runner signs resolution transactions with, in falling preference:
 * an explicit resolver key, then the devchain and deployer keys. Only the local
 * network falls back to a well-known default; every other network must supply
 * one, and a malformed key fails here rather than at signing time.
 */
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

function createReadDependencies(
  publicClient = createReadOnlyClient(),
): MarketResolutionReadDependencies {
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
    readProposedSide: async (marketAddress) => {
      const side = await publicClient.readContract({
        abi: completeSetBinaryMarketAbi,
        address: marketAddress,
        functionName: "proposedSide",
      });

      return Number(side);
    },
  };
}

function createDefaultDependencies(): MarketResolutionProposalDependencies {
  const publicClient = createReadOnlyClient();
  const account = privateKeyToAccount(readResolverPrivateKey());
  const walletClient = createWalletClient(account);

  return {
    // Same client as the reads: one transport per dependency set, not two.
    ...createReadDependencies(publicClient),
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
