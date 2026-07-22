import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { buildLocalServerEnv } from "../shared/env/buildLocalServerEnv.ts";
import { localDevIndexerHealthFile } from "../shared/env/localDevEnvFiles.ts";
import { parsePregradDeploy } from "../shared/deployments/pregradDeploy.ts";
import { deriveStackResources } from "../shared/localStack/ports.ts";

// A LOCAL_CHAIN_SMOKE_DEPLOY line as protocol/scripts/deploy-local-pregrad.ts
// emits it (recorded from a real run). local-dev.ts, local-dev-control.ts, and
// local-chain-smoke.ts parse this to configure the server env for the exact
// deployment they just created.
const DEPLOY_LINE =
  'LOCAL_CHAIN_SMOKE_DEPLOY={"chainId":31337,' +
  '"collateralAddress":"0xc5a5c42992decbae36851359345fe25997f5c42d",' +
  '"deployBlock":"30",' +
  '"postgradAdapterAddress":"0x9a676e781a523b5d0c0e43731313a708cb607508",' +
  '"pregradManagerAddress":"0x67d269191c92caf3cd7723f116c85e6e9bf55933"}';
const DEPLOY_OUTPUT = [
  "> @popcharts/protocol@0.1.0 local:deploy-pregrad /popcharts/protocol",
  "Warning: Transient storage as defined by EIP-1153 ...",
  DEPLOY_LINE,
  "",
].join("\n");

describe("parsePregradDeploy", function () {
  it("extracts the deployment record from helper output", function () {
    assert.deepEqual(parsePregradDeploy(DEPLOY_OUTPUT), {
      chainId: 31337,
      collateralAddress: "0xc5a5c42992decbae36851359345fe25997f5c42d",
      deployBlock: "30",
      postgradAdapterAddress: "0x9a676e781a523b5d0c0e43731313a708cb607508",
      pregradManagerAddress: "0x67d269191c92caf3cd7723f116c85e6e9bf55933",
    });
  });

  it("rejects output without the marker line", function () {
    assert.throws(
      () => parsePregradDeploy("Compiled 12 contracts\n"),
      /LOCAL_CHAIN_SMOKE_DEPLOY/,
    );
  });

  it("rejects payloads missing the fields it promises", function () {
    assert.throws(
      () => parsePregradDeploy(DEPLOY_LINE.replace('"chainId":31337,', "")),
      /chainId/,
    );
    assert.throws(
      () =>
        parsePregradDeploy(
          DEPLOY_LINE.replace(/"collateralAddress":"0x[0-9a-f]+",/, ""),
        ),
      /collateralAddress/,
    );
    assert.throws(
      () =>
        parsePregradDeploy(
          DEPLOY_LINE.replace(
            /"pregradManagerAddress":"0x[0-9a-f]+"/,
            '"pregradManagerAddress":"0x1234"',
          ),
        ),
      /pregradManagerAddress/,
    );
    assert.throws(
      () =>
        parsePregradDeploy(
          DEPLOY_LINE.replace(/"postgradAdapterAddress":"0x[0-9a-f]+",/, ""),
        ),
      /postgradAdapterAddress/,
    );
    assert.throws(
      () =>
        parsePregradDeploy(
          DEPLOY_LINE.replace('"deployBlock":"30"', '"deployBlock":30'),
        ),
      /deployBlock/,
    );
  });
});

describe("buildLocalServerEnv", function () {
  const resources = deriveStackResources(0);
  const managedKeys = [
    "DATABASE_URL",
    "LOCAL_API_PORT",
    "POPCHARTS_DEVCHAIN_PRIVATE_KEY",
  ];
  const savedEnv = new Map(managedKeys.map((key) => [key, process.env[key]]));

  afterEach(function () {
    for (const [key, value] of savedEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("carries a fresh deployment into the env local-create-market validates", function () {
    delete process.env.DATABASE_URL;
    delete process.env.LOCAL_API_PORT;

    const deploy = parsePregradDeploy(DEPLOY_OUTPUT);
    const env = buildLocalServerEnv(resources, {
      collateralAddress: deploy.collateralAddress,
      deployBlock: deploy.deployBlock,
      pregradManagerAddress: deploy.pregradManagerAddress,
    });

    // scripts/local-create-market.ts reads these back from the generated
    // server/.env.local-chain file and refuses to run without them.
    assert.equal(env.PREGRAD_MANAGER_ADDRESS, deploy.pregradManagerAddress);
    assert.equal(env.LOCAL_COLLATERAL_ADDRESS, deploy.collateralAddress);
    assert.equal(env.RPC_HTTP_URL, "http://127.0.0.1:8545");
    // The indexer recovers events from the recorded deploy block.
    assert.equal(env.PREGRAD_MANAGER_DEPLOY_BLOCK, deploy.deployBlock);
    assert.equal(env.LOCAL_PREGRAD_MANAGER_DEPLOY_BLOCK, deploy.deployBlock);
    assert.equal(env.PORT, "3001");
    assert.equal(env.NETWORK, "local");
    assert.equal(
      env.DATABASE_URL,
      "postgresql://postgres:postgres@localhost:5433/popcharts",
    );
  });

  it("leaves addresses blank before deployment so db:push can run", function () {
    const env = buildLocalServerEnv(resources);

    assert.equal(env.PREGRAD_MANAGER_ADDRESS, "");
    assert.equal(env.LOCAL_COLLATERAL_ADDRESS, "");
    assert.equal(env.PREGRAD_MANAGER_DEPLOY_BLOCK, "0");
  });

  it("honors the developer's env overrides", function () {
    process.env.DATABASE_URL = "postgresql://elsewhere:5555/scratch";
    process.env.LOCAL_API_PORT = "3101";

    const env = buildLocalServerEnv(resources);

    assert.equal(env.DATABASE_URL, "postgresql://elsewhere:5555/scratch");
    assert.equal(env.PORT, "3101");
  });

  it("derives every network and database value from a nonzero slot", function () {
    delete process.env.DATABASE_URL;
    delete process.env.LOCAL_API_PORT;

    const env = buildLocalServerEnv(deriveStackResources(2));

    assert.equal(env.RPC_HTTP_URL, "http://127.0.0.1:8565");
    assert.equal(env.RPC_WSS_URL, "ws://127.0.0.1:8565");
    assert.equal(env.PORT, "3021");
    assert.equal(
      env.DATABASE_URL,
      "postgresql://postgres:postgres@localhost:5433/popcharts_2",
    );
    assert.equal(env.AI_REVIEW_SERVICE_URL, "http://127.0.0.1:3022");
    // Slot-scoped so concurrent stacks never wait on each other's indexer.
    assert.equal(env.HEALTH_CHECK_FILE, `${localDevIndexerHealthFile}.2`);
  });
});
