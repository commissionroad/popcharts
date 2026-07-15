import {
  completeSetBinaryMarketAbi,
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
// CompleteSetBinaryMarket.Status: Trading = 0, Resolved = 1, Cancelled = 2.
const POSTGRAD_STATUS_TRADING = 0;
const POSTGRAD_STATUS_RESOLVED = 1;

export type ResolutionChainAction = { side: typeof SIDE_YES | typeof SIDE_NO };

export type MarketResolutionChainTransitionResult = {
  blockTimestamp: Date;
  kind: "already_transitioned" | "transitioned";
  transactionHash?: Hash;
};

export type MarketResolutionChainTransitionDependencies = {
  currentChainId: () => number;
  getLatestBlockTimestamp: () => Promise<Date>;
  readMarketStatus: (marketAddress: `0x${string}`) => Promise<number>;
  waitForTransactionTimestamp: (transactionHash: Hash) => Promise<Date>;
  writeResolution: (
    marketAddress: `0x${string}`,
    side: number,
  ) => Promise<Hash>;
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
 * Submits the resolution to the market's own CompleteSetBinaryMarket contract
 * (address per market), guarded by the on-chain status: only a market still in
 * `Trading` is resolved, and an already-`Resolved` market is a no-op. The DB
 * audit row is written by the caller only after this succeeds.
 */
export async function transitionResolvedMarketOnChain(
  {
    chainId,
    postgradMarketAddress,
    verdict,
  }: {
    chainId: number;
    postgradMarketAddress: `0x${string}`;
    verdict: ResolutionVerdict;
  },
  dependencies: MarketResolutionChainTransitionDependencies = createDefaultDependencies(),
): Promise<MarketResolutionChainTransitionResult | null> {
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
  if (currentStatus === POSTGRAD_STATUS_RESOLVED) {
    return {
      blockTimestamp: await dependencies.getLatestBlockTimestamp(),
      kind: "already_transitioned",
    };
  }

  if (currentStatus !== POSTGRAD_STATUS_TRADING) {
    throw new Error(
      `Postgrad market ${postgradMarketAddress} has contract status ${currentStatus}; expected ${POSTGRAD_STATUS_TRADING} before resolution.`,
    );
  }

  const transactionHash = await dependencies.writeResolution(
    postgradMarketAddress,
    action.side,
  );

  return {
    blockTimestamp:
      await dependencies.waitForTransactionTimestamp(transactionHash),
    kind: "transitioned",
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

function createDefaultDependencies(): MarketResolutionChainTransitionDependencies {
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
    waitForTransactionTimestamp: async (transactionHash) => {
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: transactionHash,
      });

      if (receipt.status !== "success") {
        throw new Error(
          `Resolution transition transaction failed: ${transactionHash}`,
        );
      }

      const block = await publicClient.getBlock({
        blockNumber: receipt.blockNumber,
      });

      return new Date(Number(block.timestamp) * 1000);
    },
    writeResolution: async (marketAddress, side) =>
      walletClient.writeContract({
        abi: completeSetBinaryMarketAbi,
        address: marketAddress,
        functionName: "resolve",
        args: [side],
      }),
  };
}
