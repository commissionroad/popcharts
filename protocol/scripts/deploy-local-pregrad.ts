import { network } from "hardhat";

import { deployLocalPregrad, type DeploySummary } from "./shared/deployment/deployLocalPregrad.js";

const { viem } = await network.create();
const summary = await deployLocalPregrad(viem);

// Emit a single stable machine-readable line; Hardhat may print other logs
// before or after it.
emitJson("LOCAL_CHAIN_SMOKE_DEPLOY", summary);

function emitJson(label: string, value: DeploySummary) {
  console.log(`${label}=${JSON.stringify(value)}`);
}
