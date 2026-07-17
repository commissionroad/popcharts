import assert from "node:assert/strict";
import { test } from "node:test";

import { readSlotFromEnv } from "../shared/localStack/readSlotFromEnv.ts";

test("stack slot env defaults to zero and validates explicit values", function () {
  assert.equal(readSlotFromEnv({}), 0);
  assert.equal(readSlotFromEnv({ POPCHARTS_STACK_SLOT: "2" }), 2);
  assert.throws(
    () => readSlotFromEnv({ POPCHARTS_STACK_SLOT: "2.5" }),
    /non-negative integer/,
  );
  assert.throws(
    () => readSlotFromEnv({ POPCHARTS_STACK_SLOT: "invalid" }),
    /non-negative integer/,
  );
});
