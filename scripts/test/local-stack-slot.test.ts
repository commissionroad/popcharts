import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveSlot } from "../shared/localStack/slot.ts";
import type { StackDescriptor } from "../shared/localStack/registry.ts";

function descriptor(slot: number): StackDescriptor {
  return {
    instanceId: `stack-slot${slot}`,
    slot,
    kind: slot === 0 ? "human" : "agent",
    worktreePath: "/src/popcharts",
    chainPort: 8545 + slot * 10,
    chainId: 31337 + slot,
    apiPort: 3001 + slot * 10,
    appPort: 3000 + slot * 10,
    reviewPort: 3002 + slot * 10,
    resolutionPort: 3004 + slot * 10,
    pcAdminPort: 8080 + slot,
    dbName: slot === 0 ? "popcharts" : `popcharts_${slot}`,
    envFilePath: `/src/popcharts/server/.env.local-chain.${slot}`,
    deployAddressesPath: null,
    controlPid: process.pid,
    startedAt: "2026-07-17T12:00:00.000Z",
  };
}

const allPortsFree = async (): Promise<boolean> => true;

test("a human stack starts at slot 0 when it is free", async function () {
  assert.deepEqual(
    await resolveSlot({
      cwd: "/src/popcharts",
      liveDescriptors: [],
      isPortFree: allPortsFree,
    }),
    { slot: 0, kind: "human" },
  );
});

test("a human stack advances when slot 0 is claimed", async function () {
  assert.deepEqual(
    await resolveSlot({
      cwd: "/src/popcharts",
      liveDescriptors: [descriptor(0)],
      isPortFree: allPortsFree,
    }),
    { slot: 1, kind: "human" },
  );
});

test("an agent stack starts at slot 1 when it is free", async function () {
  assert.deepEqual(
    await resolveSlot({
      cwd: "/src/popcharts/.claude/worktrees/feature",
      liveDescriptors: [],
      isPortFree: allPortsFree,
    }),
    { slot: 1, kind: "agent" },
  );
});

test("an agent stack skips a claimed slot 1", async function () {
  assert.deepEqual(
    await resolveSlot({
      cwd: "/src/popcharts/.claude/worktrees/feature",
      liveDescriptors: [descriptor(1)],
      isPortFree: allPortsFree,
    }),
    { slot: 2, kind: "agent" },
  );
});

test("an explicit free slot is honored", async function () {
  assert.deepEqual(
    await resolveSlot({
      cwd: "/src/popcharts/.claude/worktrees/feature",
      explicitSlot: 7,
      liveDescriptors: [],
      isPortFree: allPortsFree,
    }),
    { slot: 7, kind: "agent" },
  );
});

test("an explicit slot reports an occupied port without advancing", async function () {
  await assert.rejects(
    resolveSlot({
      cwd: "/src/popcharts",
      explicitSlot: 3,
      liveDescriptors: [],
      isPortFree: async (port) => port !== 8575,
    }),
    /slot 3.*port 8575.*occupied/i,
  );
});
