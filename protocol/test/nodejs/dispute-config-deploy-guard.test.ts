import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { getAddress } from "viem";

import { ARC_TESTNET } from "../../scripts/shared/chain/arcTestnet.js";
import { deployCompleteSetPostgradContracts } from "../../scripts/shared/deployment/deployCompleteSetPostgrad.js";
import {
  ALLOW_ZERO_DISPUTE_ENV_VAR,
  DISPUTE_BOND_ENV_VAR,
  DISPUTE_WINDOW_ENV_VAR,
  ZERO_DISPUTE_CONFIG_TOKEN,
  assertDeployableDisputeConfig,
  resolveDisputeConfig,
  type ZeroDisputeConfigToken,
} from "../../scripts/shared/deployment/resolveDisputeConfig.js";

const LOCAL_CHAIN_ID = 31_337;
const UINT64_MAX = 2n ** 64n - 1n;

describe("assertDeployableDisputeConfig", function () {
  it("rejects a zero window on a real chain, citing ADR 0024", function () {
    assert.throws(
      () =>
        assertDeployableDisputeConfig({
          chainId: ARC_TESTNET.chainId,
          disputeBond: 100n,
          disputeWindow: 0n,
        }),
      /ADR 0024/,
    );
  });

  it("rejects a zero bond on a real chain even with a nonzero window", function () {
    assert.throws(
      () =>
        assertDeployableDisputeConfig({
          chainId: ARC_TESTNET.chainId,
          disputeBond: 0n,
          disputeWindow: 86_400n,
        }),
      /ADR 0024/,
    );
  });

  it("accepts both values nonzero on a real chain", function () {
    assert.doesNotThrow(() =>
      assertDeployableDisputeConfig({
        chainId: ARC_TESTNET.chainId,
        disputeBond: 100n,
        disputeWindow: 86_400n,
      }),
    );
  });

  it("accepts zeros on the local devchain", function () {
    assert.doesNotThrow(() =>
      assertDeployableDisputeConfig({
        chainId: LOCAL_CHAIN_ID,
        disputeBond: 0n,
        disputeWindow: 0n,
      }),
    );
  });

  it("accepts zeros on a real chain only with the exact literal token", function () {
    assert.doesNotThrow(() =>
      assertDeployableDisputeConfig({
        allowZeroDisputeConfig: ZERO_DISPUTE_CONFIG_TOKEN,
        chainId: ARC_TESTNET.chainId,
        disputeBond: 0n,
        disputeWindow: 0n,
      }),
    );

    // A boolean-shaped or truncated bypass must not satisfy the guard: the
    // token is a literal string comparison, not truthiness.
    assert.throws(
      () =>
        assertDeployableDisputeConfig({
          allowZeroDisputeConfig: "true" as ZeroDisputeConfigToken,
          chainId: ARC_TESTNET.chainId,
          disputeBond: 0n,
          disputeWindow: 0n,
        }),
      /ADR 0024/,
    );
  });
});

describe("resolveDisputeConfig", function () {
  it("returns the locked zero config for the local chain env", function () {
    const config = resolveDisputeConfig({ chainEnv: "local", env: {} });

    assert.deepEqual(config, { disputeBond: 0n, disputeWindow: 0n });
  });

  it("requires both env vars on non-local chains, naming them", function () {
    assert.throws(
      () => resolveDisputeConfig({ chainEnv: "arc-testnet", env: {} }),
      (error: unknown) =>
        error instanceof Error &&
        error.message.includes(DISPUTE_WINDOW_ENV_VAR) &&
        error.message.includes(DISPUTE_BOND_ENV_VAR),
    );
  });

  it("still requires both env vars when the escape hatch is set", function () {
    // The hatch legalizes an explicit "0" only — never an omission.
    assert.throws(
      () =>
        resolveDisputeConfig({
          chainEnv: "arc-testnet",
          env: { [ALLOW_ZERO_DISPUTE_ENV_VAR]: ZERO_DISPUTE_CONFIG_TOKEN },
        }),
      (error: unknown) =>
        error instanceof Error &&
        error.message.includes(DISPUTE_WINDOW_ENV_VAR) &&
        error.message.includes(DISPUTE_BOND_ENV_VAR),
    );
  });

  it("rejects an explicit zero without the escape hatch", function () {
    assert.throws(
      () =>
        resolveDisputeConfig({
          chainEnv: "arc-testnet",
          env: { [DISPUTE_BOND_ENV_VAR]: "100", [DISPUTE_WINDOW_ENV_VAR]: "0" },
        }),
      new RegExp(ALLOW_ZERO_DISPUTE_ENV_VAR),
    );
  });

  it("allows explicit zeros with the exact hatch literal", function () {
    const config = resolveDisputeConfig({
      chainEnv: "arc-testnet",
      env: {
        [ALLOW_ZERO_DISPUTE_ENV_VAR]: ZERO_DISPUTE_CONFIG_TOKEN,
        [DISPUTE_BOND_ENV_VAR]: "0",
        [DISPUTE_WINDOW_ENV_VAR]: "0",
      },
    });

    assert.deepEqual(config, {
      allowZeroDisputeConfig: ZERO_DISPUTE_CONFIG_TOKEN,
      disputeBond: 0n,
      disputeWindow: 0n,
    });
  });

  it("rejects any hatch value other than the exact literal", function () {
    assert.throws(
      () =>
        resolveDisputeConfig({
          chainEnv: "arc-testnet",
          env: {
            [ALLOW_ZERO_DISPUTE_ENV_VAR]: "true",
            [DISPUTE_BOND_ENV_VAR]: "0",
            [DISPUTE_WINDOW_ENV_VAR]: "0",
          },
        }),
      new RegExp(ZERO_DISPUTE_CONFIG_TOKEN),
    );
  });

  it("parses valid values to bigints", function () {
    const config = resolveDisputeConfig({
      chainEnv: "arc-testnet",
      env: { [DISPUTE_BOND_ENV_VAR]: "250", [DISPUTE_WINDOW_ENV_VAR]: "86400" },
    });

    assert.deepEqual(config, {
      allowZeroDisputeConfig: undefined,
      disputeBond: 250n,
      disputeWindow: 86_400n,
    });
  });

  it("bounds the window to the adapter's uint64, naming the env var", function () {
    assert.doesNotThrow(() =>
      resolveDisputeConfig({
        chainEnv: "arc-testnet",
        env: {
          [DISPUTE_BOND_ENV_VAR]: "100",
          [DISPUTE_WINDOW_ENV_VAR]: UINT64_MAX.toString(),
        },
      }),
    );
    assert.throws(
      () =>
        resolveDisputeConfig({
          chainEnv: "arc-testnet",
          env: {
            [DISPUTE_BOND_ENV_VAR]: "100",
            [DISPUTE_WINDOW_ENV_VAR]: (UINT64_MAX + 1n).toString(),
          },
        }),
      (error: unknown) =>
        error instanceof Error &&
        error.message.includes(DISPUTE_WINDOW_ENV_VAR) &&
        error.message.includes("uint64"),
    );
  });

  it("rejects non-integer values, naming the env var", function () {
    assert.throws(
      () =>
        resolveDisputeConfig({
          chainEnv: "arc-testnet",
          env: { [DISPUTE_BOND_ENV_VAR]: "100", [DISPUTE_WINDOW_ENV_VAR]: "24h" },
        }),
      new RegExp(`Expected ${DISPUTE_WINDOW_ENV_VAR} to be a non-negative integer string`),
    );
  });
});

describe("deployCompleteSetPostgradContracts real-chain guard", function () {
  it("rejects zero dispute config on a non-local chainId before touching the chain", async function () {
    // Regression proof for the b3a6ddda failure class (module survives, wiring
    // gone): an in-process EDR chain overridden to a real chainId must make
    // the seam itself refuse zeros. If the guard is deleted or the seam
    // re-hardcodes the local constant, this rejects differently or not at all.
    const connection = await network.create({ override: { chainId: ARC_TESTNET.chainId } });
    const [deployer] = await connection.viem.getWalletClients();
    assert.notEqual(deployer, undefined);
    const deployerAddress = getAddress(deployer.account.address);
    // Never dereferenced: the guard throws before any chain interaction.
    const placeholder = deployerAddress;

    await assert.rejects(
      deployCompleteSetPostgradContracts({
        connection,
        deployerAddress,
        deterministicFactory: placeholder,
        disputeBond: 0n,
        disputeWindow: 0n,
        outcomeDecimals: 18,
        poolManager: placeholder,
        pregradManagerAddress: placeholder,
        resolverAddress: placeholder,
        transferApproval: placeholder,
        walletClient: deployer,
      }),
      /ADR 0024/,
    );
  });
});
