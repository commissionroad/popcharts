import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { readPostgradDeployment } from "../shared/deployments/readPostgradDeployment.ts";

// Manifests recorded from a real `local:deploy-venue` → `local:deploy-postgrad`
// → `local:create-complete-set-market` run. readPostgradDeployment turns them
// into the env local-dev and the smoke wire into the app and trading bot; if
// the protocol deploy scripts change the manifest shapes, this parse breaks.
const fixturesDir = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("readPostgradDeployment", function () {
  it("assembles the postgrad deployment from the recorded manifests", function () {
    const deployment = readPostgradDeployment("PCSM", fixturesDir);

    assert.deepEqual(deployment, {
      boundedHook: "0x3c03862Bb3ee9Bf99Dd173fD42b67214697e40C0",
      marketAddress: "0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e",
      marketSymbol: "PCSM",
      noPoolId: "0x0ca92b1a2171bf80275e36a60cbe6bd141921bf7281a4a89fbc11a56415ece1b",
      noTokenAddress: "0x3Ca8f9C04c7e3E1624Ac2008F92f6F366A869444",
      orderManager: "0xa513E6E4b8f2a923D98304ec87F64353C4D5C853",
      poolManager: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
      poolTickBounds: "0x0165878A594ca255338adfa4d48449f69242Eb8F",
      postgradAdapter: "0x610178dA211FEF7D417bC0e6FeD39F05609AD788",
      quoter: "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707",
      stateView: "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9",
      swapRouter: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
      yesPoolId: "0xabec7929565b36b26d522adc65fcfe72f21488f5e8130813ff0d204157f78e4f",
      yesTokenAddress: "0x8dAF17A20c9DBA35f005b6324F493785D239719d",
    });
  });

  it("resolves the market manifest per symbol", function () {
    assert.throws(
      () => readPostgradDeployment("MISSING", fixturesDir),
      /local\.market-missing\.local\.json/,
    );
  });
});
