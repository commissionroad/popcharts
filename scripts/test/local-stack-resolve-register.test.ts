import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { deriveStackResources } from "../shared/localStack/ports.ts";
import { readDescriptors } from "../shared/localStack/registry.ts";
import { resolveAndRegisterStack } from "../shared/localStack/resolveAndRegisterStack.ts";
import { repoRoot } from "../shared/paths.ts";

const STACK_ENV_KEYS = [
  "POPCHARTS_STACK_REGISTRY_DIR",
  "POPCHARTS_STACK_SLOT",
  "LOCAL_API_PORT",
  "LOCAL_APP_PORT",
  "LOCAL_AI_REVIEW_PORT",
  "LOCAL_AI_RESOLUTION_PORT",
] as const;

test("resolveAndRegisterStack writes the descriptor and child environment", async function () {
  const previousEnv = Object.fromEntries(
    STACK_ENV_KEYS.map((key) => [key, process.env[key]]),
  );
  const previousExitListeners = new Set(process.listeners("exit"));
  const previousSigintListeners = new Set(process.listeners("SIGINT"));
  const previousSigtermListeners = new Set(process.listeners("SIGTERM"));
  const registryPath = mkdtempSync(join(tmpdir(), "popcharts-stack-claim-"));
  const slot = 7;
  const cwd = "/tmp/popcharts/.claude/worktrees/resolve-register-test";

  process.env.POPCHARTS_STACK_REGISTRY_DIR = registryPath;
  process.env.POPCHARTS_STACK_SLOT = String(slot);

  try {
    const registered = await resolveAndRegisterStack(cwd, async () => true);
    const expectedResources = deriveStackResources(slot);
    const [descriptor] = readDescriptors();

    assert.deepEqual(registered, {
      slot,
      kind: "agent",
      instanceId: `resolve-register-test-slot${slot}`,
      resources: expectedResources,
    });
    assert.deepEqual(descriptor, {
      instanceId: registered.instanceId,
      slot,
      kind: "agent",
      worktreePath: repoRoot,
      chainPort: expectedResources.chainPort,
      chainId: expectedResources.chainId,
      apiPort: expectedResources.apiPort,
      appPort: expectedResources.appPort,
      reviewPort: expectedResources.reviewPort,
      resolutionPort: expectedResources.resolutionPort,
      pcAdminPort: expectedResources.pcAdminPort,
      dbName: expectedResources.dbName,
      envFilePath: expectedResources.envFilePath,
      deployAddressesPath: null,
      controlPid: process.pid,
      startedAt: descriptor?.startedAt,
    });
    assert.ok(Number.isFinite(Date.parse(descriptor!.startedAt)));
    assert.equal(process.env.POPCHARTS_STACK_SLOT, String(slot));
    assert.equal(process.env.LOCAL_API_PORT, String(expectedResources.apiPort));
    assert.equal(process.env.LOCAL_APP_PORT, String(expectedResources.appPort));
    assert.equal(
      process.env.LOCAL_AI_REVIEW_PORT,
      String(expectedResources.reviewPort),
    );
    assert.equal(
      process.env.LOCAL_AI_RESOLUTION_PORT,
      String(expectedResources.resolutionPort),
    );
  } finally {
    for (const listener of process.listeners("exit")) {
      if (!previousExitListeners.has(listener)) {
        process.removeListener("exit", listener);
      }
    }
    for (const listener of process.listeners("SIGINT")) {
      if (!previousSigintListeners.has(listener)) {
        process.removeListener("SIGINT", listener);
      }
    }
    for (const listener of process.listeners("SIGTERM")) {
      if (!previousSigtermListeners.has(listener)) {
        process.removeListener("SIGTERM", listener);
      }
    }
    for (const key of STACK_ENV_KEYS) {
      const previousValue = previousEnv[key];
      if (previousValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previousValue;
      }
    }
    rmSync(registryPath, { recursive: true, force: true });
  }
});

test("slot 0 retains every legacy orchestrator resource", function () {
  const resources = deriveStackResources(0);

  assert.deepEqual(
    {
      chainPort: resources.chainPort,
      apiPort: resources.apiPort,
      appPort: resources.appPort,
      pcAdminPort: resources.pcAdminPort,
      dbName: resources.dbName,
      envFilePath: resources.envFilePath,
    },
    {
      chainPort: 8545,
      apiPort: 3001,
      appPort: 3000,
      pcAdminPort: 8080,
      dbName: "popcharts",
      envFilePath: join(repoRoot, "server", ".env.local-chain"),
    },
  );
});
