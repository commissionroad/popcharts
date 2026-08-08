import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  pregradDeployOverrides,
  type PregradDeploy,
} from "../shared/deployments/pregradDeploy.ts";
import { resolvePostgradAdapterAddress } from "../shared/deployments/resolvePostgradAdapterAddress.ts";
import {
  pregradDeployServerEnv,
  pregradDeployServerEnvLines,
} from "../shared/env/pregradDeployServerEnv.ts";

/**
 * The completeness guard for the one deploy→env mapping. This mapping used
 * to exist as five hand-maintained copies, and a field missing from one copy
 * typechecked and dropped silently (the review-credit vault address left the
 * lifecycle lane running unmetered that way). These tests fail the moment
 * `PregradDeploy` grows a field whose value does not surface in the env
 * record, the env-file lines, and the orchestrator override projection.
 */

const DEPLOY: Required<PregradDeploy> = {
  chainId: 31337,
  collateralAddress: "0x0000000000000000000000000000000000000c01",
  deployBlock: "42",
  postgradAdapterAddress: "0x0000000000000000000000000000000000000ada",
  pregradManagerAddress: "0x0000000000000000000000000000000000000b01",
  reviewCreditVaultAddress: "0x0000000000000000000000000000000000000bd0",
};

// Deliberately NOT the deploy's adapter. The pregrad deploy and the venue
// deploy each produce a CompleteSetPostgradAdapter at a different address, and
// fixtures that reused one address for both are what let the double-write of
// LOCAL_POSTGRAD_ADAPTER_ADDRESS pass every assertion for as long as it did.
const VENUE = { postgradAdapter: "0x000000000000000000000000000000000000ada2" };

describe("pregradDeployServerEnv", function () {
  it("surfaces every deploy field's value in the env record", function () {
    const env = pregradDeployServerEnv(DEPLOY);
    const values = new Set(Object.values(env));

    for (const [field, value] of Object.entries(DEPLOY)) {
      if (field === "chainId") {
        continue; // Derived from the RPC by consumers, never an env var.
      }
      assert.ok(
        values.has(String(value)),
        `PregradDeploy.${field} (${String(value)}) does not surface in ` +
          "pregradDeployServerEnv — the mapping is missing the new field.",
      );
    }
  });

  it("emits blank values before a deploy so pre-deploy boots keep their shape", function () {
    const env = pregradDeployServerEnv();

    assert.equal(env.LOCAL_COLLATERAL_ADDRESS, "");
    assert.equal(env.LOCAL_REVIEW_CREDIT_VAULT_ADDRESS, "");
    assert.equal(env.PREGRAD_MANAGER_DEPLOY_BLOCK, "0");
  });
});

describe("pregradDeployServerEnvLines", function () {
  it("surfaces every deploy field's value in the generated env file", function () {
    const lines = pregradDeployServerEnvLines(DEPLOY, null);
    const joined = lines.join("\n");

    for (const [field, value] of Object.entries(DEPLOY)) {
      if (field === "chainId") {
        continue;
      }
      assert.ok(
        joined.includes(String(value)),
        `PregradDeploy.${field} is missing from the generated env lines.`,
      );
    }
  });

  it("omits blank keys instead of writing empty assignments", function () {
    const { reviewCreditVaultAddress: _omitted, ...withoutVault } = DEPLOY;
    const lines = pregradDeployServerEnvLines(withoutVault, null);

    assert.ok(
      lines.every((line) => !line.endsWith("=")),
      "an empty assignment would read as configured to fail-loud consumers",
    );
    assert.ok(
      lines.every((line) => !line.startsWith("LOCAL_REVIEW_CREDIT_VAULT")),
    );
  });
});

describe("pregradDeployOverrides", function () {
  it("projects every deploy field except chainId", function () {
    const overrides = pregradDeployOverrides(DEPLOY, null);

    assert.deepEqual(overrides, {
      collateralAddress: DEPLOY.collateralAddress,
      deployBlock: DEPLOY.deployBlock,
      postgradAdapterAddress: DEPLOY.postgradAdapterAddress,
      pregradManagerAddress: DEPLOY.pregradManagerAddress,
      reviewCreditVaultAddress: DEPLOY.reviewCreditVaultAddress,
    });
  });

  it("omits the vault on legacy deploys that predate it", function () {
    const { reviewCreditVaultAddress: _omitted, ...legacy } = DEPLOY;

    assert.ok(
      !("reviewCreditVaultAddress" in pregradDeployOverrides(legacy, null)),
    );
  });

  it("takes the venue's adapter over the pregrad deploy's when a venue exists", function () {
    assert.equal(
      pregradDeployOverrides(DEPLOY, VENUE).postgradAdapterAddress,
      VENUE.postgradAdapter,
    );
  });
});

describe("resolvePostgradAdapterAddress", function () {
  it("prefers the venue adapter, because graduated markets settle through it", function () {
    assert.equal(
      resolvePostgradAdapterAddress(VENUE, DEPLOY.postgradAdapterAddress),
      VENUE.postgradAdapter,
    );
  });

  it("falls back to the pregrad standalone adapter for --no-postgrad stacks", function () {
    assert.equal(
      resolvePostgradAdapterAddress(null, DEPLOY.postgradAdapterAddress),
      DEPLOY.postgradAdapterAddress,
    );
  });

  it("is blank before a deploy so the pre-deploy boot keeps its env shape", function () {
    assert.equal(resolvePostgradAdapterAddress(null, undefined), "");
  });
});
