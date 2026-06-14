import { network } from "hardhat";

// The root smoke script parses this payload to configure server/indexer env vars
// for the exact local deployment it just created.
type DeploySummary = {
  chainId: number;
  collateralAddress: `0x${string}`;
  deployBlock: string;
  pregradManagerAddress: `0x${string}`;
};

const { viem } = await network.create();
const publicClient = await viem.getPublicClient();

// Deploy the smallest useful protocol surface: collateral for market config and
// the singleton manager whose MarketCreated event the indexer watches.
const collateral = await viem.deployContract("MockCollateral");
const manager = await viem.deployContract("PregradManager");

// The indexer starts at this block for non-local networks. We still emit it for
// local smoke so env generation mirrors real deployment metadata.
const deployBlock = await publicClient.getBlockNumber();

// Emit a single stable machine-readable line; Hardhat may print other logs
// before or after it.
emitJson("LOCAL_CHAIN_SMOKE_DEPLOY", {
  chainId: await publicClient.getChainId(),
  collateralAddress: collateral.address,
  deployBlock: deployBlock.toString(),
  pregradManagerAddress: manager.address,
} satisfies DeploySummary);

function emitJson(label: string, value: DeploySummary) {
  console.log(`${label}=${JSON.stringify(value)}`);
}
