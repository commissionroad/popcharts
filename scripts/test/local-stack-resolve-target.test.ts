import assert from "node:assert/strict";
import { test } from "node:test";

import type { StackDescriptor } from "../shared/localStack/registry.ts";
import {
  describeTargetStack,
  resolveTargetStack,
  selectStackByToken,
  TargetStackResolutionError,
} from "../shared/localStack/resolveTargetStack.ts";

/** Builds a minimal live descriptor for a given slot. */
function stack(slot: number, instanceId: string): StackDescriptor {
  return {
    instanceId,
    slot,
    kind: slot === 0 ? "human" : "agent",
    worktreePath: `/w/${instanceId}`,
    chainPort: 8545 + 10 * slot,
    chainId: 31337,
    apiPort: 3001 + 10 * slot,
    appPort: 3000 + 10 * slot,
    reviewPort: 3002 + 10 * slot,
    resolutionPort: 3004 + 10 * slot,
    pcAdminPort: 8080 + slot,
    dbName: slot === 0 ? "popcharts" : `popcharts_${slot}`,
    envFilePath: `/w/${instanceId}/server/.env.local-chain${slot === 0 ? "" : `.${slot}`}`,
    deployAddressesPath: null,
    controlPid: 1000 + slot,
    startedAt: "2026-07-17T00:00:00.000Z",
  };
}

const slot0 = stack(0, "primary-slot0");
const slot1 = stack(1, "feature-slot1");

test("one live stack is used directly", async () => {
  assert.equal((await resolveTargetStack({ liveStacks: [slot1] })).slot, 1);
});

test("zero live stacks throws with a start hint", async () => {
  await assert.rejects(
    resolveTargetStack({ liveStacks: [] }),
    (e: unknown) =>
      e instanceof TargetStackResolutionError && /just local-dev/.test(e.message),
  );
});

test("many stacks without a token or chooser throws listing candidates", async () => {
  await assert.rejects(
    resolveTargetStack({ liveStacks: [slot0, slot1] }),
    (e: unknown) =>
      e instanceof TargetStackResolutionError &&
      /--stack/.test(e.message) &&
      e.liveStacks.length === 2,
  );
});

test("many stacks with a chooser delegates to it", async () => {
  const chosen = await resolveTargetStack({
    liveStacks: [slot0, slot1],
    chooseStack: async (stacks) => stacks[1]!,
  });
  assert.equal(chosen.slot, 1);
});

test("explicit token wins over count: by slot number", async () => {
  const chosen = await resolveTargetStack({
    liveStacks: [slot0, slot1],
    token: "1",
  });
  assert.equal(chosen.instanceId, "feature-slot1");
});

test("selectStackByToken matches an instance-id prefix", () => {
  assert.equal(selectStackByToken("feature", [slot0, slot1]).slot, 1);
});

test("selectStackByToken throws on no match", () => {
  assert.throws(
    () => selectStackByToken("9", [slot0, slot1]),
    TargetStackResolutionError,
  );
});

test("describeTargetStack is a readable one-liner", () => {
  assert.match(describeTargetStack(slot1), /slot 1 \(agent\) chain:8555 api:3011 db:popcharts_1/);
});
