import { pregradManagerAbi } from "@popcharts/protocol";

import { heuristicOutcomeMarker } from "src/ai-resolution/heuristics";
import {
  hashMarketMetadata,
  serializeMarketMetadata,
  type MarketMetadataPayload,
} from "src/indexer/metadata/market-metadata";

import { chainNowSeconds } from "./chain-time";
import {
  CREATOR_ACCOUNT_INDEX,
  collateralAddress,
  pregradManagerAddress,
  publicClient,
  walletFor,
} from "./stack";

const WAD = 10n ** 18n;

export type LifecycleMarketOptions = {
  creatorAccountIndex?: number;
  /** Seconds from the timing anchor to the graduation deadline. */
  graduationSeconds?: number;
  /**
   * Deterministic verdict for the heuristic resolution provider, appended to
   * the resolution criteria as the `[heuristic-outcome: …]` marker. Omit to
   * leave the market unresolvable (the provider abstains without a marker).
   */
  heuristicOutcome?: "yes" | "no" | "draw" | "too_early";
  question: string;
  resolutionCriteria?: string;
  /** Seconds from the timing anchor to resolutionTime (and yesNotBefore). */
  resolutionSeconds?: number;
  resolutionSources?: string[];
};

export type LifecycleMarket = {
  createdBlock: bigint;
  creator: `0x${string}`;
  graduationDeadline: bigint;
  graduationThresholdWad: bigint;
  marketId: bigint;
  metadataHash: `0x${string}`;
  resolutionTime: bigint;
};

/**
 * Creates one pregrad market on the running stack through the generated
 * PregradManager ABI, serialized and hashed by the same functions the indexer
 * verifies event payloads with. Timing anchors to whichever of chain time and
 * wall time is later: the contract validates deadlines against block
 * timestamps (which earlier scenarios may have jumped forward), while the AI
 * runners gate job eligibility on wall clock — anchoring to the later clock
 * keeps the market valid for both.
 */
export async function createLifecycleMarket(
  options: LifecycleMarketOptions,
): Promise<LifecycleMarket> {
  const wallet = walletFor(
    options.creatorAccountIndex ?? CREATOR_ACCOUNT_INDEX,
  );

  const criteria = [
    options.resolutionCriteria ??
      "Resolves per the stated question against the named source.",
    ...(options.heuristicOutcome
      ? [heuristicOutcomeMarker(options.heuristicOutcome)]
      : []),
  ].join(" ");

  const metadata: MarketMetadataPayload = {
    category: "Testing",
    createdAt: new Date().toISOString(),
    description:
      "Created by the lifecycle nightly suite (ADR 0017 Track C); asserts " +
      "the full market lifecycle against the local stack.",
    question: options.question,
    resolutionCriteria: criteria,
    resolutionSources: options.resolutionSources ?? [
      "https://example.com/lifecycle-nightly-oracle",
    ],
    version: 1,
  };
  const serialized = serializeMarketMetadata(metadata);
  const metadataHash = hashMarketMetadata(metadata) as `0x${string}`;

  const graduationSeconds = options.graduationSeconds ?? 3_600;
  const resolutionSeconds = options.resolutionSeconds ?? 7_200;
  if (resolutionSeconds <= graduationSeconds) {
    // Fail before the transaction does: the contract enforces
    // graduationDeadline < yesNotBefore <= resolutionTime and reverts with
    // InvalidResolutionTime() on inverted windows.
    throw new Error(
      `resolutionSeconds (${resolutionSeconds}) must exceed graduationSeconds (${graduationSeconds}).`,
    );
  }

  const chainNow = await chainNowSeconds();
  const wallNow = BigInt(Math.floor(Date.now() / 1000));
  const anchor = chainNow > wallNow ? chainNow : wallNow;
  const graduationDeadline = anchor + BigInt(graduationSeconds);
  const resolutionTime = anchor + BigInt(resolutionSeconds);
  // Public (non-trusted) creators must pass graduationThreshold equal to
  // liquidityParameter / 2 (PregradManager._validatePublicCreateMarketParams
  // reverts PublicGraduationThresholdMismatch otherwise). The authoritative
  // threshold is read back from getMarketConfig after creation.
  const liquidityParameterWad = 5_000n * WAD;
  const graduationThresholdWad = liquidityParameterWad / 2n;

  const creationFee = await publicClient.readContract({
    abi: pregradManagerAbi,
    address: pregradManagerAddress,
    functionName: "marketCreationFee",
    args: [wallet.account.address],
  });
  const marketCountBefore = await publicClient.readContract({
    abi: pregradManagerAbi,
    address: pregradManagerAddress,
    functionName: "marketCount",
  });

  const transactionHash = await wallet.writeContract({
    abi: pregradManagerAbi,
    address: pregradManagerAddress,
    functionName: "createMarket",
    args: [
      {
        bypassAiResolution: false,
        collateral: collateralAddress,
        graduationDeadline,
        graduationThreshold: graduationThresholdWad,
        liquidityParameter: liquidityParameterWad,
        metadata: serialized,
        metadataHash,
        openingProbabilityWad: WAD / 2n,
        resolutionTime,
        // No early YES gate for lifecycle markets: resolution opens both
        // sides at once (must satisfy deadline < yesNotBefore <= resolution).
        yesNotBefore: resolutionTime,
      },
    ],
    value: creationFee,
  });
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: transactionHash,
  });

  if (receipt.status !== "success") {
    throw new Error(`createMarket reverted: ${transactionHash}`);
  }

  const marketId = marketCountBefore + 1n;
  const marketConfig = await publicClient.readContract({
    abi: pregradManagerAbi,
    address: pregradManagerAddress,
    functionName: "getMarketConfig",
    args: [marketId],
  });

  return {
    createdBlock: receipt.blockNumber,
    creator: wallet.account.address,
    graduationDeadline,
    graduationThresholdWad: marketConfig.graduationThreshold,
    marketId,
    metadataHash,
    resolutionTime,
  };
}
