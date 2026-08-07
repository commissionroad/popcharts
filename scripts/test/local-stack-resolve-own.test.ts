import assert from "node:assert/strict";
import { test } from "node:test";

import { deriveStackResources } from "../shared/localStack/ports.ts";
import type { StackDescriptor } from "../shared/localStack/registry.ts";
import {
  OwnStackResolutionError,
  resolveOwnStack,
} from "../shared/localStack/resolveOwnStack.ts";

const PRIMARY = "/repo";
const AGENT = "/repo/.worktrees/agent";

function descriptorFor(slot: number, worktreePath: string): StackDescriptor {
  const resources = deriveStackResources(slot);

  return {
    ...resources,
    controlPid: 1000 + slot,
    deployAddressesPath: null,
    instanceId: `instance-${slot}`,
    kind: slot === 0 ? "human" : "agent",
    startedAt: "2026-08-07T00:00:00.000Z",
    worktreePath,
  };
}

test("returns the stack started from this worktree", function () {
  const own = resolveOwnStack({
    liveStacks: [descriptorFor(0, PRIMARY), descriptorFor(1, AGENT)],
    worktreePath: AGENT,
  });

  assert.equal(own.slot, 1);
  assert.equal(own.pcAdminPort, 8090);
});

// The load-bearing case. `resolveTargetStack` would hand back the only running
// stack whatever worktree owns it; doing that here is how a worktree with no
// stack ends up commanding — and stopping — the primary checkout's.
test("never falls back to the only running stack when it is not ours", function () {
  assert.throws(
    () =>
      resolveOwnStack({
        liveStacks: [descriptorFor(0, PRIMARY)],
        worktreePath: AGENT,
      }),
    (error: unknown) => {
      assert.ok(error instanceof OwnStackResolutionError);
      assert.match(error.message, /No local dev stack is running for this worktree/);
      assert.match(error.message, /do not act on these/);
      assert.equal(error.foreignStacks.length, 1);
      return true;
    },
  );
});

test("reports plainly when nothing is running anywhere", function () {
  assert.throws(
    () => resolveOwnStack({ liveStacks: [], worktreePath: AGENT }),
    /No local dev stack is running anywhere/,
  );
});

test("refuses to guess when the registry lists two stacks for one worktree", function () {
  assert.throws(
    () =>
      resolveOwnStack({
        liveStacks: [descriptorFor(1, AGENT), descriptorFor(2, AGENT)],
        worktreePath: AGENT,
      }),
    /refusing to guess/,
  );
});
