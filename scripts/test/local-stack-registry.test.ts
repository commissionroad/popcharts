import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  pruneDeadDescriptors,
  readDescriptors,
  registryDir,
  removeDescriptor,
  writeDescriptor,
  type StackDescriptor,
} from "../shared/localStack/registry.ts";

function descriptor(overrides: Partial<StackDescriptor> = {}): StackDescriptor {
  return {
    instanceId: "popcharts-slot0",
    slot: 0,
    kind: "human",
    worktreePath: "/src/popcharts",
    chainPort: 8545,
    chainId: 31337,
    apiPort: 3001,
    appPort: 3000,
    reviewPort: 3002,
    resolutionPort: 3004,
    pcAdminPort: 8080,
    dbName: "popcharts",
    envFilePath: "/src/popcharts/server/.env.local-chain",
    deployAddressesPath: null,
    controlPid: process.pid,
    startedAt: "2026-07-17T12:00:00.000Z",
    ...overrides,
  };
}

test("registry round-trips descriptors and prunes dead entries", async function () {
  const previousRegistryDir = process.env.POPCHARTS_STACK_REGISTRY_DIR;
  const tempRegistryDir = mkdtempSync(
    join(tmpdir(), "popcharts-stack-registry-"),
  );
  process.env.POPCHARTS_STACK_REGISTRY_DIR = tempRegistryDir;

  try {
    assert.equal(registryDir(), tempRegistryDir);
    assert.deepEqual(readDescriptors(), []);

    const liveRecord = descriptor();
    writeDescriptor(liveRecord);
    assert.deepEqual(readDescriptors(), [liveRecord]);
    assert.match(
      readFileSync(join(tempRegistryDir, "popcharts-slot0.json"), "utf8"),
      /\n  "slot": 0,/,
    );

    writeFileSync(join(tempRegistryDir, "malformed.json"), "not json");
    assert.deepEqual(readDescriptors(), [liveRecord]);

    removeDescriptor(liveRecord.instanceId);
    removeDescriptor(liveRecord.instanceId);
    assert.deepEqual(readDescriptors(), []);

    const deadRecord = descriptor({
      instanceId: "dead-slot1",
      slot: 1,
      chainPort: 65534,
      controlPid: 2_147_483_647,
    });
    writeDescriptor(deadRecord);
    assert.deepEqual(await pruneDeadDescriptors(), []);
    assert.deepEqual(readDescriptors(), []);
  } finally {
    if (previousRegistryDir === undefined) {
      delete process.env.POPCHARTS_STACK_REGISTRY_DIR;
    } else {
      process.env.POPCHARTS_STACK_REGISTRY_DIR = previousRegistryDir;
    }
    rmSync(tempRegistryDir, { recursive: true, force: true });
  }
});
