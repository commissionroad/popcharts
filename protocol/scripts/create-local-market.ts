import { network } from "hardhat";
import {
  getAddress,
  isAddress,
  isHash,
  keccak256,
  stringToBytes,
  type Address,
  type Hash,
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
  metadataHash: `0x${string}`;
  pregradManagerAddress: Address;
  resolutionTime: string;
  transactionHash: `0x${string}`;
};

// The smoke script injects the freshly deployed addresses through env vars so
// this helper can stay focused on the one onchain action it owns.
const managerAddress = readAddress("PREGRAD_MANAGER_ADDRESS");
const collateralAddress = readAddress("LOCAL_COLLATERAL_ADDRESS", "COLLATERAL_ADDRESS");
const timing = readMarketTiming();

const metadataHash = readMetadataHash();

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
  metadataHash,
  pregradManagerAddress: managerAddress,
  resolutionTime: resolutionTime.toString(),
  transactionHash,
} satisfies MarketSummary);

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

function readMetadataHash(): Hash {
  const explicitHash = process.env.LOCAL_MARKET_METADATA_HASH;

  if (explicitHash) {
    if (!isHash(explicitHash)) {
      throw new Error(
        `LOCAL_MARKET_METADATA_HASH must be a bytes32 hex string; received ${explicitHash}`,
      );
    }

    return explicitHash;
  }

  // There is no metadata upload in the smoke fallback. Hash a deterministic-ish
  // URI shape so the emitted event still exercises the metadataHash indexer path.
  const metadataUri =
    process.env.LOCAL_MARKET_METADATA ?? `ipfs://popcharts/local-smoke/${new Date().toISOString()}`;

  return keccak256(stringToBytes(metadataUri));
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

function emitJson(label: string, value: MarketSummary) {
  console.log(`${label}=${JSON.stringify(value)}`);
}
