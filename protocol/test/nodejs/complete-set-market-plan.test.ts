import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PublicClient } from "viem";

import { readMarketSnapshot } from "../../scripts/operate-postgrad-admin.js";
import { POSTGRAD_MARKET_STATUS } from "../../src/postgrad-market-status.js";
import {
  describeCompleteSetMarketState,
  determineDisputeBondSettlement,
  planCompleteSetMarketAction,
  type CompleteSetMarketSnapshot,
} from "../../scripts/shared/market/planCompleteSetMarketAction.js";

const RESOLVER = "0x1111111111111111111111111111111111111111";
const OWNER = "0x2222222222222222222222222222222222222222";
const DISPUTER = "0x3333333333333333333333333333333333333333";
const ZERO = "0x0000000000000000000000000000000000000000";

const NOW = 1_700_000_000n;
const BOND = 5_000_000n; // 5.00 units of a 6-decimal collateral token.

function snapshot(overrides: Partial<CompleteSetMarketSnapshot> = {}): CompleteSetMarketSnapshot {
  return {
    collateralDecimals: 6,
    disputeBond: BOND,
    disputeBondHeld: 0n,
    disputeWindow: 86_400n,
    disputer: ZERO,
    notBefore: { no: NOW - 100n, yes: NOW - 100n },
    owner: OWNER,
    proposal: undefined,
    resolver: RESOLVER,
    status: POSTGRAD_MARKET_STATUS.trading,
    timestamp: NOW,
    ...overrides,
  };
}

function pending(overrides: Partial<CompleteSetMarketSnapshot> = {}): CompleteSetMarketSnapshot {
  return snapshot({
    proposal: { deadline: NOW + 3_600n, side: "yes" },
    status: POSTGRAD_MARKET_STATUS.resolutionPending,
    ...overrides,
  });
}

function disputed(overrides: Partial<CompleteSetMarketSnapshot> = {}): CompleteSetMarketSnapshot {
  return pending({
    disputeBondHeld: BOND,
    disputer: DISPUTER,
    status: POSTGRAD_MARKET_STATUS.disputed,
    ...overrides,
  });
}

describe("planCompleteSetMarketAction: resolve", () => {
  it("encodes the winning side against a zero-window market", () => {
    const plan = planCompleteSetMarketAction(snapshot({ disputeWindow: 0n }), {
      kind: "resolveMarket",
      side: "no",
    });
    assert.deepEqual(plan.call, { args: [1], functionName: "resolve" });
    assert.equal(plan.expectedStatus, POSTGRAD_MARKET_STATUS.resolved);
    assert.equal(plan.requiredRole?.holder, RESOLVER);
    assert.equal(plan.requiredRole?.name, "CompleteSetBinaryMarket resolver");
  });

  it("refuses a direct resolve when a dispute window is configured", () => {
    assert.throws(
      () => planCompleteSetMarketAction(snapshot(), { kind: "resolveMarket", side: "yes" }),
      /86400s \(1d\) dispute window.*MarketNotDirectlyResolvable/,
    );
  });

  it("refuses a market that has left Trading", () => {
    assert.throws(
      () =>
        planCompleteSetMarketAction(snapshot({ status: POSTGRAD_MARKET_STATUS.disputed }), {
          kind: "resolveMarket",
          side: "yes",
        }),
      /status is Disputed \(4\); resolve requires Trading \(0\)/,
    );
  });
});

describe("planCompleteSetMarketAction: cancel", () => {
  it("plans a cancellation from Trading", () => {
    const plan = planCompleteSetMarketAction(snapshot(), { kind: "cancelMarket" });
    assert.deepEqual(plan.call, { args: [], functionName: "cancel" });
    assert.equal(plan.expectedStatus, POSTGRAD_MARKET_STATUS.cancelled);
    assert.match(plan.proposedDescription, /half collateral value/);
    assert.doesNotMatch(plan.proposedDescription, /bond/);
  });

  it("allows cancelling a disputed market and reports the bond refund", () => {
    const plan = planCompleteSetMarketAction(disputed(), { kind: "cancelMarket" });
    assert.match(plan.proposedDescription, /REFUNDED to the disputer 0x3333/);
    assert.match(plan.proposedDescription, /5 \(5000000 raw\)/);
  });

  it("refuses a terminal market", () => {
    assert.throws(
      () =>
        planCompleteSetMarketAction(snapshot({ status: POSTGRAD_MARKET_STATUS.resolved }), {
          kind: "cancelMarket",
        }),
      /status is Resolved \(1\); cancel requires a non-terminal status/,
    );
  });
});

describe("describeCompleteSetMarketState", () => {
  it("surfaces every dispute field once a proposal is disputed", () => {
    assert.equal(
      describeCompleteSetMarketState(disputed()),
      "status = Disputed (4), resolver = 0x1111111111111111111111111111111111111111, " +
        "dispute window = 86400s (1d), dispute bond = 5 (5000000 raw), proposed side = YES, " +
        "dispute deadline = 1700003600 (1h remaining), " +
        "disputer = 0x3333333333333333333333333333333333333333, bond held = 5 (5000000 raw)",
    );
  });

  it("names the absent proposal and disputer while trading", () => {
    const description = describeCompleteSetMarketState(snapshot({ disputeWindow: 0n }));
    assert.match(description, /status = Trading \(0\)/);
    assert.match(description, /dispute window = 0s \(disputes disabled\)/);
    assert.match(description, /proposal = none/);
    assert.match(description, /disputer = none/);
  });
});

describe("readMarketSnapshot", () => {
  // Answers every market read from one table, so a test can state exactly what
  // the contract reports and nothing can leak in from a manifest.
  function stubClient(collateralDecimals: number): PublicClient {
    const reads: Record<string, unknown> = {
      collateralDecimals,
      disputeBond: BOND,
      disputeBondHeld: 0n,
      disputeWindow: 3_600n,
      disputer: ZERO,
      noNotBefore: 0n,
      owner: OWNER,
      resolver: RESOLVER,
      status: POSTGRAD_MARKET_STATUS.trading,
      yesNotBefore: 0n,
    };
    return {
      getBlock: async () => ({ timestamp: NOW }),
      readContract: async ({ functionName }: { functionName: string }) => reads[functionName],
    } as unknown as PublicClient;
  }

  it("renders the bond with the market's decimals, not a manifest's", async () => {
    const six = await readMarketSnapshot(stubClient(6), RESOLVER);
    const eighteen = await readMarketSnapshot(stubClient(18), RESOLVER);
    assert.equal(six.collateralDecimals, 6);
    assert.match(describeCompleteSetMarketState(six), /dispute bond = 5 \(5000000 raw\)/);
    assert.match(describeCompleteSetMarketState(eighteen), /dispute bond = 0\.000000000005 /);
  });
});

describe("determineDisputeBondSettlement", () => {
  const base = { bondHeld: BOND, disputer: DISPUTER, owner: OWNER, proposedSide: "yes" } as const;

  it("refunds the disputer when the settled side differs from the proposal", () => {
    assert.deepEqual(determineDisputeBondSettlement({ ...base, settledSide: "no" }), {
      amount: BOND,
      kind: "refunded",
      to: DISPUTER,
    });
  });

  it("forfeits to the market owner when the proposal stands", () => {
    assert.deepEqual(determineDisputeBondSettlement({ ...base, settledSide: "yes" }), {
      amount: BOND,
      kind: "forfeited",
      to: OWNER,
    });
  });

  it("moves nothing when no bond is escrowed (resolver self-dispute)", () => {
    assert.deepEqual(
      determineDisputeBondSettlement({ ...base, bondHeld: 0n, settledSide: "yes" }),
      {
        kind: "none",
      },
    );
  });
});

describe("planCompleteSetMarketAction: propose-resolution", () => {
  it("encodes the proposed side and projects the deadline", () => {
    const plan = planCompleteSetMarketAction(snapshot(), { kind: "proposeResolution", side: "no" });
    assert.deepEqual(plan.call, { args: [1], functionName: "proposeResolution" });
    assert.equal(plan.expectedStatus, POSTGRAD_MARKET_STATUS.resolutionPending);
    assert.match(plan.proposedDescription, /dispute deadline ~1700086400 \(1d after/);
  });

  it("says a zero-window proposal is finalizable in the same block", () => {
    const plan = planCompleteSetMarketAction(snapshot({ disputeWindow: 0n }), {
      kind: "proposeResolution",
      side: "yes",
    });
    assert.match(plan.proposedDescription, /finalizable in the same block/);
  });

  it("refuses before the side's resolution gate and reports the wait", () => {
    assert.throws(
      () =>
        planCompleteSetMarketAction(snapshot({ notBefore: { no: NOW + 600n, yes: NOW - 100n } }), {
          kind: "proposeResolution",
          side: "no",
        }),
      /NO resolution gate opens at 1700000600 — 10m away.*TooEarlyToResolve/,
    );
  });
});

describe("planCompleteSetMarketAction: dispute-market", () => {
  it("refuses a non-resolver caller as CLI policy, not as a contract revert", () => {
    const plan = planCompleteSetMarketAction(pending(), { kind: "disputeMarket" });
    assert.deepEqual(plan.call, { args: [], functionName: "dispute" });
    // A non-resolver is refused because only the resolver holds this role...
    assert.equal(plan.requiredRole?.holder, RESOLVER);
    // ...and the refusal says the call would succeed and spend the bond, so the
    // operator is not told a permissionless call would revert.
    const reason = plan.requiredRole?.nonHolderConsequence ?? "";
    assert.match(reason, /only performs the resolver's bond-free override/);
    assert.match(reason, /would not revert/);
    assert.match(reason, /spend 5 \(5000000 raw\) of collateral/);
    assert.match(reason, /app's dispute panel instead/);
  });

  it("describes the override and the bond a public disputer would post", () => {
    const plan = planCompleteSetMarketAction(pending(), { kind: "disputeMarket" });
    assert.match(plan.proposedDescription, /bond-free operator override/);
    assert.match(plan.proposedDescription, /5 \(5000000 raw\) bond/);
  });

  it("refuses once the window has closed", () => {
    assert.throws(
      () =>
        planCompleteSetMarketAction(pending({ timestamp: NOW + 3_600n }), {
          kind: "disputeMarket",
        }),
      /dispute window closed at 1700003600 .*DisputeWindowClosed/,
    );
  });
});

describe("planCompleteSetMarketAction: settle-dispute", () => {
  it("reports a refund, its amount, and the disputer when the outcome changes", () => {
    const plan = planCompleteSetMarketAction(disputed(), { kind: "settleDispute", side: "no" });
    assert.deepEqual(plan.call, { args: [1], functionName: "resolve" });
    assert.equal(plan.expectedStatus, POSTGRAD_MARKET_STATUS.resolved);
    assert.equal(plan.requiredRole?.holder, RESOLVER);
    assert.match(plan.proposedDescription, /REFUNDED to the disputer 0x3333/);
    assert.match(plan.proposedDescription, /5 \(5000000 raw\)/);
    assert.doesNotMatch(plan.proposedDescription, /FORFEITED/);
  });

  it("reports a forfeit to the market owner when the proposal stands", () => {
    const plan = planCompleteSetMarketAction(disputed(), { kind: "settleDispute", side: "yes" });
    assert.deepEqual(plan.call, { args: [0], functionName: "resolve" });
    assert.match(plan.proposedDescription, /FORFEITED to the market owner 0x2222/);
    assert.doesNotMatch(plan.proposedDescription, /REFUNDED/);
  });

  it("reports that nothing moves after a bond-free resolver self-dispute", () => {
    const plan = planCompleteSetMarketAction(
      disputed({ disputeBondHeld: 0n, disputer: RESOLVER }),
      {
        kind: "settleDispute",
        side: "yes",
      },
    );
    assert.match(plan.proposedDescription, /No bond is escrowed/);
  });

  it("refuses a market that is not Disputed", () => {
    assert.throws(
      () => planCompleteSetMarketAction(pending(), { kind: "settleDispute", side: "yes" }),
      /status is ResolutionPending \(3\); settleDispute requires Disputed \(4\)/,
    );
  });
});

describe("planCompleteSetMarketAction: finalize-resolution", () => {
  it("refuses before the deadline and reports the wait", () => {
    assert.throws(
      () => planCompleteSetMarketAction(pending(), { kind: "finalizeResolution" }),
      /open until 1700003600 — 1h remaining .*DisputeWindowStillOpen/,
    );
  });

  it("finalizes permissionlessly at the deadline, matching the contract's >= check", () => {
    const plan = planCompleteSetMarketAction(pending({ timestamp: NOW + 3_600n }), {
      kind: "finalizeResolution",
    });
    assert.deepEqual(plan.call, { args: [], functionName: "finalizeResolution" });
    assert.equal(plan.expectedStatus, POSTGRAD_MARKET_STATUS.resolved);
    assert.equal(plan.requiredRole, undefined);
    assert.match(plan.proposedDescription, /Permissionless/);
    assert.match(plan.proposedDescription, /winning side YES/);
  });
});
