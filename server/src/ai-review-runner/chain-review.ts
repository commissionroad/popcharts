import { pregradManagerAbi } from "@popcharts/protocol";
import type { Hash } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { MarketStatus } from "src/api/models/markets";
import {
  createReadOnlyClient,
  createWalletClient,
} from "src/blockchain/client";
import { config, ZERO_ADDRESS } from "src/config";

const DEFAULT_LOCAL_REVIEW_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const PREGRAD_MARKET_STATUS_ACTIVE = 0;
const PREGRAD_MARKET_STATUS_UNDER_REVIEW = 7;
const PREGRAD_MARKET_STATUS_REJECTED = 8;

export type ReviewTransitionFunctionName = "approveMarket" | "rejectMarket";

export type MarketReviewChainAction = {
  functionName: ReviewTransitionFunctionName;
  targetStatus: number;
};

export type MarketReviewChainTransitionResult = {
  blockTimestamp: Date;
  kind: "already_transitioned" | "transitioned";
  transactionHash?: Hash;
};

export type MarketReviewChainTransitionDependencies = {
  currentChainId: () => number;
  getLatestBlockTimestamp: () => Promise<Date>;
  readMarketStatus: (marketId: bigint) => Promise<number>;
  waitForTransactionTimestamp: (transactionHash: Hash) => Promise<Date>;
  writeReviewTransition: (
    functionName: ReviewTransitionFunctionName,
    marketId: bigint,
  ) => Promise<Hash>;
};

/**
 * Converts the off-chain review decision into the exact contract transition
 * required before the API may expose the market as tradeable or rejected.
 */
export function marketReviewChainAction(
  targetMarketStatus: MarketStatus,
): MarketReviewChainAction | null {
  if (targetMarketStatus === "bootstrap") {
    return {
      functionName: "approveMarket",
      targetStatus: PREGRAD_MARKET_STATUS_ACTIVE,
    };
  }

  if (targetMarketStatus === "rejected") {
    return {
      functionName: "rejectMarket",
      targetStatus: PREGRAD_MARKET_STATUS_REJECTED,
    };
  }

  return null;
}

/**
 * Applies the review result to the PregradManager first. The SQL projection is
 * allowed to move only after this succeeds, keeping quote/placeReceipt aligned
 * with the contract's lifecycle guard.
 */
export async function transitionReviewedMarketOnChain(
  {
    chainId,
    marketId,
    targetMarketStatus,
  }: {
    chainId: number;
    marketId: bigint;
    targetMarketStatus: MarketStatus;
  },
  dependencies: MarketReviewChainTransitionDependencies = createDefaultMarketReviewChainTransitionDependencies(),
): Promise<MarketReviewChainTransitionResult | null> {
  const action = marketReviewChainAction(targetMarketStatus);

  if (!action) {
    return null;
  }

  const currentChainId = dependencies.currentChainId();
  if (chainId !== currentChainId) {
    throw new Error(
      `Review job chain ${chainId} does not match configured chain ${currentChainId}.`,
    );
  }

  const currentStatus = await dependencies.readMarketStatus(marketId);
  if (currentStatus === action.targetStatus) {
    return {
      blockTimestamp: await dependencies.getLatestBlockTimestamp(),
      kind: "already_transitioned",
    };
  }

  if (currentStatus !== PREGRAD_MARKET_STATUS_UNDER_REVIEW) {
    throw new Error(
      `Market ${marketId.toString()} has contract status ${currentStatus}; expected ${PREGRAD_MARKET_STATUS_UNDER_REVIEW} before review transition.`,
    );
  }

  const transactionHash = await dependencies.writeReviewTransition(
    action.functionName,
    marketId,
  );

  return {
    blockTimestamp:
      await dependencies.waitForTransactionTimestamp(transactionHash),
    kind: "transitioned",
    transactionHash,
  };
}

export function readReviewManagerPrivateKey(
  env: Record<string, string | undefined> = process.env,
  networkName = config.name,
): `0x${string}` {
  const value =
    env.POPCHARTS_REVIEW_MANAGER_PRIVATE_KEY ??
    env.POPCHARTS_DEVCHAIN_PRIVATE_KEY ??
    env.POPCHARTS_DEPLOYER_PRIVATE_KEY ??
    (networkName === "local" ? DEFAULT_LOCAL_REVIEW_PRIVATE_KEY : undefined);

  if (!value) {
    throw new Error(
      "A review manager private key is required for market review transitions.",
    );
  }

  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(
      "The review manager private key must be a 32-byte hex key.",
    );
  }

  return value as `0x${string}`;
}

function createDefaultMarketReviewChainTransitionDependencies(): MarketReviewChainTransitionDependencies {
  if (
    !config.contracts.pregradManager ||
    config.contracts.pregradManager === ZERO_ADDRESS
  ) {
    throw new Error(
      "PREGRAD_MANAGER_ADDRESS is required for market review transitions.",
    );
  }

  const publicClient = createReadOnlyClient();
  const account = privateKeyToAccount(readReviewManagerPrivateKey());
  const walletClient = createWalletClient(account);

  return {
    currentChainId: () => config.chainId,
    getLatestBlockTimestamp: async () => {
      const block = await publicClient.getBlock();

      return new Date(Number(block.timestamp) * 1000);
    },
    readMarketStatus: async (marketId) => {
      const state = (await publicClient.readContract({
        abi: pregradManagerAbi,
        address: config.contracts.pregradManager,
        functionName: "getMarketState",
        args: [marketId],
      })) as { status: number };

      return Number(state.status);
    },
    waitForTransactionTimestamp: async (transactionHash) => {
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: transactionHash,
      });

      if (receipt.status !== "success") {
        throw new Error(
          `Review transition transaction failed: ${transactionHash}`,
        );
      }

      const block = await publicClient.getBlock({
        blockNumber: receipt.blockNumber,
      });

      return new Date(Number(block.timestamp) * 1000);
    },
    writeReviewTransition: async (functionName, marketId) => {
      if (functionName === "approveMarket") {
        return await walletClient.writeContract({
          abi: pregradManagerAbi,
          address: config.contracts.pregradManager,
          functionName: "approveMarket",
          args: [marketId],
        });
      }

      return await walletClient.writeContract({
        abi: pregradManagerAbi,
        address: config.contracts.pregradManager,
        functionName: "rejectMarket",
        args: [marketId],
      });
    },
  };
}
