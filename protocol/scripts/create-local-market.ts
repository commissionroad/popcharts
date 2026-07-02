import { network } from "hardhat";
import {
  getAddress,
  isAddress,
  keccak256,
  stringToBytes,
  type Address,
} from "viem";

const WAD = 10n ** 18n;
const DAY_SECONDS = 24n * 60n * 60n;
const DEFAULT_GRADUATION_SECONDS = 7n * DAY_SECONDS;
const DEFAULT_RESOLUTION_SECONDS = 14n * DAY_SECONDS;

// This summary is the contract between the Hardhat helper and the root smoke
// orchestrator. Keep values stringified where JSON would otherwise lose bigint
// precision.
type MarketSummary = {
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

type MarketMetadata = {
  category: string;
  createdAt: string;
  description: string;
  question: string;
  resolutionCriteria: string;
  resolutionSources?: string[];
  resolutionUrl?: string;
  version: 1;
};

// The smoke script injects the freshly deployed addresses through env vars so
// this helper can stay focused on the one onchain action it owns.
const managerAddress = readAddress("PREGRAD_MANAGER_ADDRESS");
const collateralAddress = readAddress("LOCAL_COLLATERAL_ADDRESS", "COLLATERAL_ADDRESS");
const timing = readMarketTiming();

const metadataPayload = readMarketMetadataPayload(
  process.env.LOCAL_MARKET_METADATA ?? serializeMarketMetadata(buildLocalMarketMetadata()),
);
const serializedMetadata = serializeMarketMetadata(metadataPayload);
const metadataHash = hashMarketMetadata(metadataPayload);

const { viem } = await network.create();
const publicClient = await viem.getPublicClient();
const [creator] = await viem.getWalletClients();
const manager = await viem.getContractAt("PregradManager", managerAddress);
const nextMarketId = ((await manager.read.marketCount()) as bigint) + 1n;
const latestBlock = await publicClient.getBlock();
const graduationDeadline = latestBlock.timestamp + timing.graduationSeconds;
const resolutionTime = latestBlock.timestamp + timing.resolutionSeconds;
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
      bypassAiResolution: false,
    },
  ],
  { value: creationFee },
);
const receipt = await publicClient.waitForTransactionReceipt({
  hash: transactionHash,
});

// Emit one parseable line for scripts/local-chain-smoke.mjs. Everything else in
// Hardhat output is meant for humans and should not be scraped.
emitJson("LOCAL_CHAIN_SMOKE_MARKET", {
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
} satisfies MarketSummary);

function buildLocalMarketMetadata(): MarketMetadata {
  const createdAt = new Date().toISOString();

  return {
    category: "Crypto",
    createdAt,
    description: "Local smoke market created by the direct protocol helper for indexer recovery.",
    question: `Will the local Pop Charts smoke market created at ${createdAt} be indexed?`,
    resolutionCriteria:
      "Resolves YES if the local development indexer records this direct contract-created market.",
    resolutionSources: ["Local Hardhat chain", "Pop Charts local indexer"],
    version: 1,
  };
}

function hashMarketMetadata(metadata: MarketMetadata): `0x${string}` {
  return keccak256(stringToBytes(serializeMarketMetadata(metadata)));
}

function readMarketMetadataPayload(value: string): MarketMetadata {
  return parseMarketMetadata(JSON.parse(value) as unknown);
}

function parseMarketMetadata(value: unknown): MarketMetadata {
  if (!isRecord(value)) {
    throw new Error("Market metadata must be a JSON object.");
  }

  if (value.version !== 1) {
    throw new Error("Market metadata version must be 1.");
  }

  const metadata: MarketMetadata = {
    category: readString(value, "category"),
    createdAt: readString(value, "createdAt"),
    description: readString(value, "description"),
    question: readString(value, "question"),
    resolutionCriteria: readString(value, "resolutionCriteria"),
    version: 1,
  };

  if (value.resolutionUrl !== undefined) {
    metadata.resolutionUrl = readString(value, "resolutionUrl");
  }
  if (value.resolutionSources !== undefined) {
    metadata.resolutionSources = readStringArray(value, "resolutionSources");
  }

  return metadata;
}

function serializeMarketMetadata(metadata: MarketMetadata): string {
  const ordered: Record<string, string | number | string[]> = {
    version: metadata.version,
    question: metadata.question,
    description: metadata.description,
    category: metadata.category,
    resolutionCriteria: metadata.resolutionCriteria,
  };

  if (metadata.resolutionSources?.length) {
    ordered.resolutionSources = metadata.resolutionSources;
  }
  if (metadata.resolutionUrl) {
    ordered.resolutionUrl = metadata.resolutionUrl;
  }

  ordered.createdAt = metadata.createdAt;

  return JSON.stringify(ordered);
}

function readAddress(...names: string[]): Address {
  // Accept fallback env var names so this helper can be reused by a developer
  // running it directly with either local-smoke or generic collateral naming.
  for (const name of names) {
    const value = process.env[name];

    if (!value) {
      continue;
    }

    if (!isAddress(value)) {
      throw new Error(`${name} must be an EVM address; received ${value}`);
    }

    return getAddress(value);
  }

  throw new Error(`${names.join(" or ")} is required.`);
}

function readMarketTiming(): {
  graduationSeconds: bigint;
  resolutionSeconds: bigint;
} {
  const graduationSeconds = readPositiveSeconds(
    "LOCAL_MARKET_GRADUATION_SECONDS",
    DEFAULT_GRADUATION_SECONDS,
  );
  const resolutionSeconds = readPositiveSeconds(
    "LOCAL_MARKET_RESOLUTION_SECONDS",
    DEFAULT_RESOLUTION_SECONDS,
  );

  if (resolutionSeconds <= graduationSeconds) {
    throw new Error(
      "LOCAL_MARKET_RESOLUTION_SECONDS must be greater than " + "LOCAL_MARKET_GRADUATION_SECONDS.",
    );
  }

  return { graduationSeconds, resolutionSeconds };
}

function readPositiveSeconds(name: string, fallback: bigint): bigint {
  const value = process.env[name];

  if (!value) {
    return fallback;
  }

  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${name} must be a positive integer number of seconds.`);
  }

  return BigInt(value);
}

function readString(value: Record<string, unknown>, field: string): string {
  const fieldValue = value[field];

  if (typeof fieldValue !== "string") {
    throw new Error(`Market metadata ${field} must be a string.`);
  }

  return fieldValue;
}

function readStringArray(value: Record<string, unknown>, field: string): string[] {
  const fieldValue = value[field];

  if (!Array.isArray(fieldValue) || fieldValue.some((item) => typeof item !== "string")) {
    throw new Error(`Market metadata ${field} must be an array of strings.`);
  }

  return fieldValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function emitJson(label: string, value: MarketSummary) {
  console.log(`${label}=${JSON.stringify(value)}`);
}
