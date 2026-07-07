import { network } from "hardhat";
import { getAddress, isAddress, type Address } from "viem";

import { createLocalMarket, type MarketSummary } from "./shared/market/createLocalMarket.js";
import {
  buildLocalSmokeMarketMetadata,
  parseMarketMetadata,
  serializeMarketMetadata,
} from "./shared/market/localMarketMetadata.js";
import { readMarketTiming } from "./shared/market/localMarketTiming.js";

// The smoke script injects the freshly deployed addresses through env vars so
// this helper can stay focused on the one onchain action it owns.
const managerAddress = readAddress("PREGRAD_MANAGER_ADDRESS");
const collateralAddress = readAddress("LOCAL_COLLATERAL_ADDRESS", "COLLATERAL_ADDRESS");
const timing = readMarketTiming();

const metadataPayload = parseMarketMetadata(
  JSON.parse(
    process.env.LOCAL_MARKET_METADATA ?? serializeMarketMetadata(buildLocalSmokeMarketMetadata()),
  ) as unknown,
);

const { viem } = await network.create();
const summary = await createLocalMarket({
  collateralAddress,
  managerAddress,
  metadata: metadataPayload,
  timing,
  viem,
});

// Emit one parseable line for the root orchestrators. Everything else in
// Hardhat output is meant for humans and should not be scraped.
emitJson("LOCAL_CHAIN_SMOKE_MARKET", summary);

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
