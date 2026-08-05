import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AUTO_TOP_UP_WAD,
  depositCommandEnv,
  topUpAmountWad,
  waitForIndexedCredit,
} from "../shared/localMarket/autoTopUpCredit.ts";
import { DraftApiError } from "../shared/localMarket/draftFlow.ts";

const RATE_WAD = (10n ** 18n / 10n).toString();

function shortfallBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    availableWad: "0",
    message: "You're out of review credit.",
    requiredWad: RATE_WAD,
    runsUsed: 0,
    ...overrides,
  });
}

function position(availableWad: bigint) {
  return {
    availableWad: availableWad.toString(),
    metered: true,
    rateWad: RATE_WAD,
    runsRemaining: Number(availableWad / BigInt(RATE_WAD)),
    runsUsed: 0,
  };
}

/** Resolves immediately; the poll's waiting is not what these tests measure. */
const noSleep = async () => undefined;

describe("DraftApiError", () => {
  it("parses the meter's 402 body into a shortfall", () => {
    const error = new DraftApiError("failed (402)", {
      body: shortfallBody({ runsUsed: 3 }),
      status: 402,
    });

    assert.equal(error.status, 402);
    assert.equal(error.shortfall?.requiredWad, RATE_WAD);
    assert.equal(error.shortfall?.runsUsed, 3);
  });

  it("keeps the message a caller would print unchanged", () => {
    const error = new DraftApiError(
      "Draft API POST /drafts/1/submit failed (402): {}",
      {
        body: "{}",
        status: 402,
      },
    );

    assert.equal(
      error.message,
      "Draft API POST /drafts/1/submit failed (402): {}",
    );
  });

  it("leaves the shortfall undefined for a non-meter body", () => {
    const validation = new DraftApiError("failed (422)", {
      body: JSON.stringify({ message: "bad request" }),
      status: 422,
    });
    const html = new DraftApiError("failed (502)", {
      body: "<html>gateway</html>",
      status: 502,
    });

    assert.equal(validation.shortfall, undefined);
    assert.equal(html.shortfall, undefined);
  });

  it("leaves the shortfall undefined when a field has the wrong type", () => {
    // runsUsed as a string is the shape a hand-rolled mock would produce; the
    // auto top-up must not act on a body it did not really understand.
    const error = new DraftApiError("failed (402)", {
      body: shortfallBody({ runsUsed: "3" }),
      status: 402,
    });

    assert.equal(error.shortfall, undefined);
  });
});

describe("topUpAmountWad", () => {
  it("deposits the standard $1 when one review costs less", () => {
    const amount = topUpAmountWad({
      availableWad: "0",
      message: "",
      requiredWad: RATE_WAD,
      runsUsed: 0,
    });

    assert.equal(amount, AUTO_TOP_UP_WAD);
  });

  it("covers the gap exactly when one review costs more than the standard top-up", () => {
    // Depositing less than the shortfall would retry straight into the same
    // refusal, so the rate — not the preset — sets the floor here.
    const required = AUTO_TOP_UP_WAD * 3n;
    const amount = topUpAmountWad({
      availableWad: "0",
      message: "",
      requiredWad: required.toString(),
      runsUsed: 0,
    });

    assert.equal(amount, required);
  });

  it("subtracts credit already held from the gap", () => {
    const required = AUTO_TOP_UP_WAD * 3n;
    const amount = topUpAmountWad({
      availableWad: (AUTO_TOP_UP_WAD * 2n).toString(),
      message: "",
      requiredWad: required.toString(),
      runsUsed: 4,
    });

    // Gap is $1, which does not exceed the standard top-up.
    assert.equal(amount, AUTO_TOP_UP_WAD);
  });
});

describe("depositCommandEnv", () => {
  const VAULT = "0x00000000000000000000000000000000000000bd";
  const BENEFICIARY = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

  it("carries the resolved chain env to the spawned helper", () => {
    // The seam that hides slot leaks: the helper runs `--network localhost`,
    // which only honours POPCHARTS_LOCAL_RPC_URL. Drop it and a slot-1 run
    // deposits on slot 0's chain and then blames the indexer.
    const env = depositCommandEnv({
      amountWad: AUTO_TOP_UP_WAD,
      beneficiary: BENEFICIARY,
      chainEnv: { POPCHARTS_LOCAL_RPC_URL: "http://127.0.0.1:8555" },
      commandEnv: {
        POPCHARTS_LOCAL_RPC_URL: "http://127.0.0.1:8545",
        PATH: "/usr/bin",
      },
      vaultAddress: VAULT,
    });

    assert.equal(env.POPCHARTS_LOCAL_RPC_URL, "http://127.0.0.1:8555");
    assert.equal(env.PATH, "/usr/bin");
  });

  it("names the vault, beneficiary, and amount the helper requires", () => {
    const env = depositCommandEnv({
      amountWad: AUTO_TOP_UP_WAD,
      beneficiary: BENEFICIARY,
      chainEnv: {},
      commandEnv: {},
      vaultAddress: VAULT,
    });

    assert.equal(env.LOCAL_REVIEW_CREDIT_VAULT_ADDRESS, VAULT);
    assert.equal(env.POPCHARTS_CREDIT_BENEFICIARY, BENEFICIARY);
    assert.equal(env.POPCHARTS_CREDIT_AMOUNT_WAD, AUTO_TOP_UP_WAD.toString());
  });

  it("overrides a stale vault address from the loaded env file", () => {
    const env = depositCommandEnv({
      amountWad: AUTO_TOP_UP_WAD,
      beneficiary: BENEFICIARY,
      chainEnv: {},
      commandEnv: { LOCAL_REVIEW_CREDIT_VAULT_ADDRESS: "0xdeadbeef" },
      vaultAddress: VAULT,
    });

    assert.equal(env.LOCAL_REVIEW_CREDIT_VAULT_ADDRESS, VAULT);
  });
});

describe("waitForIndexedCredit", () => {
  it("returns once the indexed balance covers the run", async () => {
    let calls = 0;
    const covered = await waitForIndexedCredit({
      readCredit: async () => {
        calls += 1;
        return position(calls > 2 ? AUTO_TOP_UP_WAD : 0n);
      },
      requiredWad: RATE_WAD,
      sleep: noSleep,
    });

    assert.equal(covered, true);
    assert.equal(calls, 3);
  });

  it("treats a read failure as not-yet-indexed rather than giving up", async () => {
    let calls = 0;
    const covered = await waitForIndexedCredit({
      readCredit: async () => {
        calls += 1;

        if (calls === 1) {
          throw new Error("connection reset");
        }

        return position(AUTO_TOP_UP_WAD);
      },
      requiredWad: RATE_WAD,
      sleep: noSleep,
    });

    assert.equal(covered, true);
    assert.equal(calls, 2);
  });

  it("gives up at the deadline rather than polling forever", async () => {
    let clock = 0;
    const covered = await waitForIndexedCredit({
      // Advances past the timeout on the second check.
      now: () => (clock += 20_000),
      readCredit: async () => position(0n),
      requiredWad: RATE_WAD,
      sleep: noSleep,
      timeoutMs: 30_000,
    });

    assert.equal(covered, false);
  });

  it("checks once before it can time out", async () => {
    // A deposit that indexed instantly must not be missed by a clock that has
    // already passed the deadline.
    let calls = 0;
    const covered = await waitForIndexedCredit({
      now: () => 10_000_000,
      readCredit: async () => {
        calls += 1;
        return position(AUTO_TOP_UP_WAD);
      },
      requiredWad: RATE_WAD,
      sleep: noSleep,
      timeoutMs: 0,
    });

    assert.equal(covered, true);
    assert.equal(calls, 1);
  });
});
