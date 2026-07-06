import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { getAddress } from "viem";

import { deployLocalPregrad } from "../../scripts/shared/deployment/deployLocalPregrad.js";
import { createLocalMarket } from "../../scripts/shared/market/createLocalMarket.js";
import { buildLocalSmokeMarketMetadata } from "../../scripts/shared/market/localMarketMetadata.js";

const HOUR_SECONDS = 60n * 60n;

describe("deploy-local-pregrad helper", async function () {
  const { viem } = await network.create();

  it("deploys the contracts the local dev stack watches", async function () {
    const publicClient = await viem.getPublicClient();
    const summary = await deployLocalPregrad(viem);

    assert.equal(summary.chainId, 31337);
    assert.match(summary.deployBlock, /^\d+$/);
    assert.notEqual(await publicClient.getCode({ address: summary.collateralAddress }), undefined);
    assert.notEqual(
      await publicClient.getCode({ address: summary.pregradManagerAddress }),
      undefined,
    );
    assert.notEqual(
      await publicClient.getCode({ address: summary.postgradAdapterAddress }),
      undefined,
    );

    const manager = await viem.getContractAt("PregradManager", summary.pregradManagerAddress);
    assert.equal(await manager.read.marketCount(), 0n);
  });

  it("emits the summary fields the local dev orchestrators parse", async function () {
    const summary = await deployLocalPregrad(viem);

    // scripts/local-dev.ts, scripts/local-dev-control.ts, and
    // scripts/local-chain-smoke.ts parse this object back from the
    // LOCAL_CHAIN_SMOKE_DEPLOY stdout line (scripts/shared/deployments/
    // pregradDeploy.ts). Removing or renaming a key is a breaking change to
    // that contract.
    assert.deepEqual(Object.keys(summary).sort(), [
      "chainId",
      "collateralAddress",
      "deployBlock",
      "postgradAdapterAddress",
      "pregradManagerAddress",
    ]);
    assert.deepEqual(JSON.parse(JSON.stringify(summary)), summary);
  });

  it("hands createLocalMarket a working deployment, like just local-dev does", async function () {
    // The exact seam chain behind `just local-dev` + `just local-create-market`:
    // the deploy summary's addresses flow through the generated env file into
    // the market creation helper.
    const summary = await deployLocalPregrad(viem);
    const market = await createLocalMarket({
      collateralAddress: summary.collateralAddress,
      managerAddress: summary.pregradManagerAddress,
      metadata: buildLocalSmokeMarketMetadata(),
      timing: { graduationSeconds: HOUR_SECONDS, resolutionSeconds: 2n * HOUR_SECONDS },
      viem,
    });

    assert.equal(market.chainId, summary.chainId);
    assert.equal(market.marketId, "1");
    assert.equal(
      getAddress(market.pregradManagerAddress),
      getAddress(summary.pregradManagerAddress),
    );

    const manager = await viem.getContractAt("PregradManager", summary.pregradManagerAddress);
    assert.equal(await manager.read.marketCount(), 1n);
  });
});
