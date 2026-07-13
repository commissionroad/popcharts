import type { network } from "hardhat";
import { getAddress, type Address } from "viem";

import {
  hashMarketMetadata,
  serializeMarketMetadata,
  type MarketMetadata,
} from "./localMarketMetadata.js";
import { resolveDeadlineAnchor, type MarketTiming } from "./localMarketTiming.js";

const WAD = 10n ** 18n;

type LocalNetworkViem = Awaited<ReturnType<typeof network.create>>["viem"];

// This summary is the contract between the Hardhat helper and the root
// local-create-market / local-chain-smoke orchestrators, which parse it back
// from a LOCAL_CHAIN_SMOKE_MARKET stdout line. Keep values stringified where
// JSON would otherwise lose bigint precision.
export type MarketSummary = {
  blockNumber: string;
  chainId: number;
  collateralAddress: Address;
  creator: Address;
  graduationDeadline: string;
  marketId: string;
  metadata: string;
  metadataHash: `0x${string}`;
  pregradManagerAddress: Address;
  resolutionTime: string;
  transactionHash: `0x${string}`;
};

export type CreateLocalMarketArgs = {
  collateralAddress: Address;
  managerAddress: Address;
  metadata: MarketMetadata;
  /** Wall-clock seconds; overridable so tests can pin the deadline anchor. */
  nowSeconds?: bigint;
  timing: MarketTiming;
  viem: LocalNetworkViem;
};

/**
 * Creates one market on the connected local chain through the PregradManager
 * ABI and returns the summary the root orchestrators parse. This is the one
 * seam where the local dev scripts call the protocol's market creation
 * entrypoint, so protocol-side changes to createMarket surface here first.
 */
export async function createLocalMarket(args: CreateLocalMarketArgs): Promise<MarketSummary> {
  const { collateralAddress, managerAddress, metadata, timing, viem } = args;
  const serializedMetadata = serializeMarketMetadata(metadata);
  const metadataHash = hashMarketMetadata(metadata);

  const publicClient = await viem.getPublicClient();
  const [creator] = await viem.getWalletClients();
  const manager = await viem.getContractAt("PregradManager", managerAddress);
  const nextMarketId = ((await manager.read.marketCount()) as bigint) + 1n;
  const latestBlock = await publicClient.getBlock();
  const nowSeconds = args.nowSeconds ?? BigInt(Math.floor(Date.now() / 1000));
  const anchorTimestamp = resolveDeadlineAnchor(latestBlock.timestamp, nowSeconds);
  const graduationDeadline = anchorTimestamp + timing.graduationSeconds;
  const resolutionTime = anchorTimestamp + timing.resolutionSeconds;
  const creationFee = (await manager.read.marketCreationFee([creator.account.address])) as bigint;

  // Use realistic WAD-scaled values here. The smoke should catch schema/indexer
  // bugs around uint256 storage, not avoid them with tiny test numbers.
  const transactionHash = await manager.write.createMarket(
    [
      {
        collateral: collateralAddress,
        metadataHash,
        metadata: serializedMetadata,
        openingProbabilityWad: (50n * WAD) / 100n,
        liquidityParameter: 5_000n * WAD,
        graduationThreshold: 2_500n * WAD,
        graduationDeadline,
        resolutionTime,
        // No early YES for local markets: the YES gate equals the deadline.
        yesNotBefore: resolutionTime,
        bypassAiResolution: false,
      },
    ],
    { value: creationFee },
  );
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: transactionHash,
  });

  return {
    blockNumber: receipt.blockNumber.toString(),
    chainId: await publicClient.getChainId(),
    collateralAddress,
    creator: getAddress(creator.account.address),
    graduationDeadline: graduationDeadline.toString(),
    marketId: nextMarketId.toString(),
    metadata: serializedMetadata,
    metadataHash,
    pregradManagerAddress: managerAddress,
    resolutionTime: resolutionTime.toString(),
    transactionHash,
  };
}
