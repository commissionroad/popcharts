import assert from "node:assert/strict";
import { test } from "node:test";

import {
  deriveInstanceId,
  detectStackKind,
} from "../shared/localStack/identity.ts";

test("stack kind detects only the .claude/worktrees path segment", function () {
  assert.equal(
    detectStackKind("/src/popcharts/.claude/worktrees/adr-0020"),
    "agent",
  );
  assert.equal(detectStackKind("/src/popcharts"), "human");
  assert.equal(
    detectStackKind("/src/popcharts/.claude/worktrees-extra/adr-0020"),
    "human",
  );
});

test("instance ids sanitize the checkout leaf and include the slot", function () {
  assert.equal(
    deriveInstanceId("/src/popcharts/.claude/worktrees/ADR 0020_Concurrent!", 1),
    "adr-0020-concurrent-slot1",
  );
  assert.equal(deriveInstanceId("/src/popcharts", 0), "popcharts-slot0");
  assert.match(deriveInstanceId("/src/###", 2), /^[a-z0-9-]+$/);
});
