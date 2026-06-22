import { network } from "hardhat";
import { getAddress, isAddress, keccak256, stringToBytes, type Address } from "viem";

const WAD = 10n ** 18n;
const DAY_SECONDS = 24n * 60n * 60n;

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

// There is no metadata upload in the smoke. Hash a deterministic-ish URI shape
// so the emitted event still exercises the metadataHash indexer path.
const metadataUri =
  process.env.LOCAL_MARKET_METADATA ?? `ipfs://popcharts/local-smoke/${new Date().toISOString()}`;
const metadataHash = keccak256(stringToBytes(metadataUri));

const { viem } = await network.create();
const publicClient = await viem.getPublicClient();
const [creator] = await viem.getWalletClients();
const manager = await viem.getContractAt("PregradManager", managerAddress);
const nextMarketId = (await manager.read.nextMarketId()) as bigint;
const latestBlock = await publicClient.getBlock();
const graduationDeadline = latestBlock.timestamp + 7n * DAY_SECONDS;
const resolutionTime = graduationDeadline + 7n * DAY_SECONDS;
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

function emitJson(label: string, value: MarketSummary) {
  console.log(`${label}=${JSON.stringify(value)}`);
}
