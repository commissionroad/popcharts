import { describe, expect, it } from "bun:test";

import type { ResolutionResult } from "src/ai-resolution/types";

import {
  buildMarketResolutionRequest,
  decideResolutionAction,
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
