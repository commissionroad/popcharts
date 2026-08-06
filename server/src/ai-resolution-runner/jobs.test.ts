import { describe, expect, it } from "bun:test";

import type { ResolutionResult } from "src/ai-resolution/types";

import {
  buildMarketResolutionRequest,
  CHAIN_VERDICT_DIVERGENCE_HARD_FLAG,
  decideResolutionAction,
  decideStandDownAction,
  isRunnerAuditOnlyMarketStatus,
  isRunnerEligibleMarketStatus,
  reconcileVerdictWithChain,
  type ClaimedResolutionJob,
  type MarketMetadataRow,
  type MarketResolutionJobRow,
  type MarketRow,
} from "./jobs";

const NO_NOT_BEFORE = new Date("2026-06-01T00:00:00.000Z"); // = resolution_time
const YES_NOT_BEFORE = new Date("2026-05-01T00:00:00.000Z"); // early-YES gate

function verdict(value: ResolutionResult["verdict"]) {
  return { verdict: value } as Pick<ResolutionResult, "verdict">;
}

describe("isRunnerEligibleMarketStatus", () => {
  it("keeps working a market whose proposal already landed on-chain", () => {
    expect(isRunnerEligibleMarketStatus("graduated")).toBe(true);
    // Without this the runner cancels its own retry: the attempt that proposed
    // but died before persisting its audit row comes back to a market that is
    // no longer `graduated`.
    expect(isRunnerEligibleMarketStatus("resolution_pending")).toBe(true);
  });

  it("drops a market that is settled, contested, or not yet graduated", () => {
    // A dispute is a human's problem, not the AI's.
    expect(isRunnerEligibleMarketStatus("disputed")).toBe(false);
    expect(isRunnerEligibleMarketStatus("resolved")).toBe(false);
    expect(isRunnerEligibleMarketStatus("cancelled")).toBe(false);
    expect(isRunnerEligibleMarketStatus("bootstrap")).toBe(false);
  });
});

describe("isRunnerAuditOnlyMarketStatus", () => {
  it("still owes an audit row for a market carrying an on-chain proposal", () => {
    expect(isRunnerAuditOnlyMarketStatus("disputed")).toBe(true);
    expect(isRunnerAuditOnlyMarketStatus("resolved")).toBe(true);
  });

  it("owes nothing for a market that never reached a proposal", () => {
    expect(isRunnerAuditOnlyMarketStatus("cancelled")).toBe(false);
    expect(isRunnerAuditOnlyMarketStatus("bootstrap")).toBe(false);
    expect(isRunnerAuditOnlyMarketStatus("graduated")).toBe(false);
  });
});

describe("decideStandDownAction", () => {
  // The lost-audit-row case: the attempt that proposed died before writing, and
  // a disputer moved the market before the retry landed. Cancelling here is what
  // used to delete the evidence for good.
  it("records before cancelling when a contested market has no audit row", () => {
    expect(
      decideStandDownAction({ hasResolution: false, status: "disputed" }),
    ).toBe("record_then_cancel");
  });

  it("just cancels when the audit row is already written", () => {
    expect(
      decideStandDownAction({ hasResolution: true, status: "disputed" }),
    ).toBe("cancel");
  });

  it("just cancels a market that never carried a proposal", () => {
    expect(
      decideStandDownAction({ hasResolution: false, status: "cancelled" }),
    ).toBe("cancel");
  });
});

describe("reconcileVerdictWithChain", () => {
  const result: ResolutionResult = {
    confidence: 0.9,
    evidence: [],
    hardFlags: ["sources_disagree"],
    outcome: "no",
    promptVersion: "v1",
    provider: "anthropic",
    reasons: ["The model's own reason."],
    sourceChecks: [],
    verdict: "resolve_no",
  };

  it("leaves an agreeing verdict untouched", () => {
    expect(
      reconcileVerdictWithChain({
        proposedSide: "no",
        result,
        verdict: "resolve_no",
      }),
    ).toEqual({ result, verdict: "resolve_no" });
  });

  // A retry re-runs the model from scratch, so it can reach a verdict the chain
  // never acted on. The chain moved the money, so the chain wins the column.
  it("records the on-chain side when the re-run disagrees", () => {
    const reconciled = reconcileVerdictWithChain({
      proposedSide: "yes",
      result,
      verdict: "resolve_no",
    });

    expect(reconciled.verdict).toBe("resolve_yes");
    expect(reconciled.result.hardFlags).toEqual([
      "sources_disagree",
      CHAIN_VERDICT_DIVERGENCE_HARD_FLAG,
    ]);
  });

  // A re-run that abstains still disagrees with a proposal that was acted on,
  // and an operator adjudicating the dispute needs to see that gap.
  it("flags a re-run that would not have decided at all", () => {
    const reconciled = reconcileVerdictWithChain({
      proposedSide: "yes",
      result: { ...result, outcome: "abstain", verdict: "manual_review" },
      verdict: "manual_review",
    });

    expect(reconciled.verdict).toBe("resolve_yes");
    expect(reconciled.result.hardFlags).toContain(
      CHAIN_VERDICT_DIVERGENCE_HARD_FLAG,
    );
  });

  it("keeps the disagreeing run's own outcome and reasons readable", () => {
    const reconciled = reconcileVerdictWithChain({
      proposedSide: "yes",
      result,
      verdict: "resolve_no",
    });

    // The model's conclusion is evidence about the dispute, not something to
    // overwrite — only the acted-on verdict comes from the chain.
    expect(reconciled.result.outcome).toBe("no");
    expect(reconciled.result.reasons).toEqual([
      "Recorded resolve_yes to match the proposal already on-chain; this run concluded resolve_no.",
      "The model's own reason.",
    ]);
  });
});

describe("decideResolutionAction", () => {
  const market = {
    resolutionTime: NO_NOT_BEFORE,
    yesNotBefore: YES_NOT_BEFORE,
  };
  const base = { backoffMs: 60_000, market };

  it("submits YES once past the YES gate", () => {
    expect(
      decideResolutionAction({
        ...base,
        now: new Date("2026-05-02T00:00:00.000Z"),
        result: verdict("resolve_yes"),
      }),
    ).toEqual({ kind: "persist", submit: true, verdict: "resolve_yes" });
  });

  it("re-queues YES before the YES gate to the gate", () => {
    const decision = decideResolutionAction({
      ...base,
      now: new Date("2026-04-01T00:00:00.000Z"),
      result: verdict("resolve_yes"),
    });
    expect(decision.kind).toBe("requeue");
    if (decision.kind === "requeue") {
      expect(decision.runAfter).toEqual(YES_NOT_BEFORE);
    }
  });

  it("re-queues NO before the deadline to the deadline (never submits early)", () => {
    const decision = decideResolutionAction({
      ...base,
      now: new Date("2026-05-15T00:00:00.000Z"),
      result: verdict("resolve_no"),
    });
    expect(decision.kind).toBe("requeue");
    if (decision.kind === "requeue") {
      expect(decision.runAfter).toEqual(NO_NOT_BEFORE);
    }
  });

  it("submits NO once past the deadline", () => {
    expect(
      decideResolutionAction({
        ...base,
        now: new Date("2026-06-02T00:00:00.000Z"),
        result: verdict("resolve_no"),
      }),
    ).toEqual({ kind: "persist", submit: true, verdict: "resolve_no" });
  });

  it("re-queues too_early with backoff before the deadline", () => {
    const now = new Date("2026-05-15T00:00:00.000Z");
    const decision = decideResolutionAction({
      ...base,
      now,
      result: verdict("requeue_too_early"),
    });
    expect(decision.kind).toBe("requeue");
    if (decision.kind === "requeue") {
      expect(decision.runAfter).toEqual(new Date(now.getTime() + 60_000));
    }
  });

  it("escalates a stuck too_early to manual review past the deadline", () => {
    expect(
      decideResolutionAction({
        ...base,
        now: new Date("2026-06-02T00:00:00.000Z"),
        result: verdict("requeue_too_early"),
      }),
    ).toEqual({ kind: "persist", submit: false, verdict: "manual_review" });
  });

  it("parks draws and manual reviews with an audit row and no submission", () => {
    const now = new Date("2026-06-02T00:00:00.000Z");
    expect(
      decideResolutionAction({ ...base, now, result: verdict("cancel_draw") }),
    ).toEqual({ kind: "persist", submit: false, verdict: "cancel_draw" });
    expect(
      decideResolutionAction({
        ...base,
        now,
        result: verdict("manual_review"),
      }),
    ).toEqual({ kind: "persist", submit: false, verdict: "manual_review" });
  });

  it("falls back to resolution_time as the YES gate when yes_not_before is null", () => {
    const decision = decideResolutionAction({
      backoffMs: 60_000,
      market: { resolutionTime: NO_NOT_BEFORE, yesNotBefore: null },
      now: new Date("2026-05-15T00:00:00.000Z"),
      result: verdict("resolve_yes"),
    });
    expect(decision.kind).toBe("requeue");
    if (decision.kind === "requeue") {
      expect(decision.runAfter).toEqual(NO_NOT_BEFORE);
    }
  });
});

const jobRow = (overrides: Partial<MarketResolutionJobRow> = {}) =>
  ({
    requestedModel: null,
    requestedProvider: null,
    ...overrides,
  }) as unknown as MarketResolutionJobRow;

const marketRow = () =>
  ({
    chainId: 31337,
    creator: "0xcreator",
    marketId: 7n,
  }) as unknown as MarketRow;

const metadataRow = (overrides: Partial<MarketMetadataRow> = {}) =>
  ({
    category: "sports",
    description: "d",
    metadataHash: "0xhash",
    observationWindowEnd: null,
    observationWindowStart: null,
    question: "Did it happen?",
    resolutionCriteria: "criteria",
    resolutionSources: [],
    resolutionUrl: null,
    ...overrides,
  }) as unknown as MarketMetadataRow;

function claimed(
  overrides: {
    job?: Partial<MarketResolutionJobRow>;
    metadata?: Partial<MarketMetadataRow>;
  } = {},
): ClaimedResolutionJob {
  return {
    job: jobRow(overrides.job),
    market: marketRow(),
    metadata: metadataRow(overrides.metadata),
    postgradMarketAddress: `0x${"ab".repeat(20)}`,
  };
}

describe("buildMarketResolutionRequest", () => {
  it("includes context and metadata, omitting empty optionals", () => {
    const request = buildMarketResolutionRequest(claimed());

    expect(request.context).toEqual({
      chainId: 31337,
      creator: "0xcreator",
      marketId: "7",
      postgradMarketAddress: `0x${"ab".repeat(20)}`,
    });
    expect(request.metadata.question).toBe("Did it happen?");
    expect(request.metadata.resolutionSources).toBeUndefined();
    expect(request.metadata.resolutionUrl).toBeUndefined();
    expect(request.metadata.observationWindowStart).toBeUndefined();
    expect(request.options).toBeUndefined();
  });

  it("includes sources, url, observation window, and provider/model options", () => {
    const request = buildMarketResolutionRequest(
      claimed({
        job: { requestedModel: "claude-x", requestedProvider: "anthropic" },
        metadata: {
          observationWindowEnd: new Date("2026-12-31T00:00:00.000Z"),
          observationWindowStart: new Date("2026-01-01T00:00:00.000Z"),
          resolutionSources: ["https://a.com"],
          resolutionUrl: "https://b.com",
        },
      }),
    );

    expect(request.metadata.resolutionSources).toEqual(["https://a.com"]);
    expect(request.metadata.resolutionUrl).toBe("https://b.com");
    expect(request.metadata.observationWindowStart).toBe(
      "2026-01-01T00:00:00.000Z",
    );
    expect(request.options).toEqual({
      model: "claude-x",
      provider: "anthropic",
    });
  });

  it("drops a `manual` requestedProvider from the request options", () => {
    const request = buildMarketResolutionRequest(
      claimed({ job: { requestedProvider: "manual" } }),
    );

    expect(request.options).toBeUndefined();
  });
});
