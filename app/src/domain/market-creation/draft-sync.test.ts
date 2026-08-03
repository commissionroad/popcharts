import type { MarketDraftWrite } from "@popcharts/api-client/models";
import { describe, expect, it } from "vitest";

import { createInitialMarketDraft } from "@/domain/market-creation/create-market";
import {
  dateTimeLocalToWindowSeconds,
  formDraftToWrite,
  serverDraftToFormDraft,
  stableWrite,
  WINDOW_DRIFT_TOLERANCE_SECONDS,
  windowToDateTimeLocal,
  writeChangesServerDraft,
} from "@/domain/market-creation/draft-sync";
import { marketDraftFactory } from "@/test/factories/drafts";

// A minute-aligned local anchor so datetime-local values (which drop seconds)
// round-trip exactly.
const NOW = new Date("2030-07-01T12:00:00");

describe("windowToDateTimeLocal", () => {
  it("converts a relative window into the absolute deadline the form shows", () => {
    expect(windowToDateTimeLocal(3_600, NOW)).toBe(
      localValue(new Date("2030-07-01T13:00:00"))
    );
  });
});

describe("dateTimeLocalToWindowSeconds", () => {
  it("round-trips the window a form deadline represents", () => {
    const value = windowToDateTimeLocal(21_600, NOW);

    expect(dateTimeLocalToWindowSeconds(value, NOW)).toBe(21_600);
  });

  it("rounds sub-second drift to whole seconds", () => {
    const value = windowToDateTimeLocal(3_600, NOW);

    expect(dateTimeLocalToWindowSeconds(value, new Date(NOW.getTime() + 400))).toBe(
      3_600
    );
  });

  it("falls back to the minimum window for an empty value", () => {
    expect(dateTimeLocalToWindowSeconds("", NOW)).toBe(60);
  });

  it("falls back to the minimum window for an unparseable value", () => {
    expect(dateTimeLocalToWindowSeconds("not-a-date", NOW)).toBe(60);
  });

  it("clamps past deadlines to the minimum window", () => {
    const value = windowToDateTimeLocal(-7_200, NOW);

    expect(dateTimeLocalToWindowSeconds(value, NOW)).toBe(60);
  });
});

describe("formDraftToWrite", () => {
  it("maps the form draft into the server write payload", () => {
    const draft = {
      ...createInitialMarketDraft(NOW),
      description: "Settles on the daily close.",
      outcomeNo: "No way",
      outcomeYes: "Yes way",
      question: "Will it sync?",
      resolutionCriteria: "Resolves YES on sync.",
      resolutionSources: "https://example.com",
      resolutionUrl: "https://example.com/page",
    };

    expect(formDraftToWrite(draft, NOW)).toEqual({
      category: "Crypto",
      description: "Settles on the daily close.",
      graduationWindowSeconds: 3_600,
      liquidityParameter: 5_000,
      openingProbability: 50,
      outcomeNo: "No way",
      outcomeYes: "Yes way",
      question: "Will it sync?",
      resolutionCriteria: "Resolves YES on sync.",
      resolutionSources: "https://example.com",
      resolutionUrl: "https://example.com/page",
      resolutionWindowSeconds: 604_800,
    });
  });
});

describe("serverDraftToFormDraft", () => {
  it("rebuilds the form model with deadlines anchored at now", () => {
    const serverDraft = marketDraftFactory();

    const formDraft = serverDraftToFormDraft(serverDraft, NOW);

    expect(formDraft).toEqual({
      bypassAiResolution: false,
      category: "Crypto",
      createdAt: serverDraft.createdAt,
      description: serverDraft.description,
      graduationPreset: "6h",
      graduationTime: windowToDateTimeLocal(21_600, NOW),
      liquidityParameter: 5_000,
      openingProbability: 55,
      outcomeNo: "",
      outcomeYes: "",
      question: serverDraft.question,
      resolutionCriteria: serverDraft.resolutionCriteria,
      resolutionSources: serverDraft.resolutionSources,
      resolutionPreset: "1w",
      resolutionTime: windowToDateTimeLocal(604_800, NOW),
      resolutionUrl: "",
    });
  });

  it("falls back to the Crypto category for unknown stored categories", () => {
    const formDraft = serverDraftToFormDraft(
      marketDraftFactory({ category: "Interpretive Dance" }),
      NOW
    );

    expect(formDraft.category).toBe("Crypto");
  });

  it("matches presets within the drift tolerance", () => {
    const formDraft = serverDraftToFormDraft(
      marketDraftFactory({
        graduationWindowSeconds: 3_600 + WINDOW_DRIFT_TOLERANCE_SECONDS,
        resolutionWindowSeconds: 86_400 - WINDOW_DRIFT_TOLERANCE_SECONDS,
      }),
      NOW
    );

    expect(formDraft.graduationPreset).toBe("1h");
    expect(formDraft.resolutionPreset).toBe("1d");
  });

  it("labels windows beyond every preset tolerance as custom", () => {
    const formDraft = serverDraftToFormDraft(
      marketDraftFactory({
        graduationWindowSeconds: 3_600 + WINDOW_DRIFT_TOLERANCE_SECONDS + 1,
        resolutionWindowSeconds: 100_000,
      }),
      NOW
    );

    expect(formDraft.graduationPreset).toBe("custom");
    expect(formDraft.resolutionPreset).toBe("custom");
  });
});

describe("stableWrite", () => {
  it("returns the write untouched when there is no server draft yet", () => {
    const write = writeFromServerDraft(marketDraftFactory());

    expect(stableWrite(write, null)).toBe(write);
  });

  it("drops window fields that only drifted within the tolerance", () => {
    const serverDraft = marketDraftFactory();
    const write = {
      ...writeFromServerDraft(serverDraft),
      graduationWindowSeconds:
        serverDraft.graduationWindowSeconds + WINDOW_DRIFT_TOLERANCE_SECONDS,
      resolutionWindowSeconds:
        serverDraft.resolutionWindowSeconds - WINDOW_DRIFT_TOLERANCE_SECONDS,
    };

    const stable = stableWrite(write, serverDraft);

    expect(stable).not.toHaveProperty("graduationWindowSeconds");
    expect(stable).not.toHaveProperty("resolutionWindowSeconds");
    expect(stable.question).toBe(serverDraft.question);
  });

  it("keeps window fields that moved beyond the tolerance", () => {
    const serverDraft = marketDraftFactory();
    const write = {
      ...writeFromServerDraft(serverDraft),
      graduationWindowSeconds:
        serverDraft.graduationWindowSeconds + WINDOW_DRIFT_TOLERANCE_SECONDS + 1,
      resolutionWindowSeconds:
        serverDraft.resolutionWindowSeconds + WINDOW_DRIFT_TOLERANCE_SECONDS + 1,
    };

    const stable = stableWrite(write, serverDraft);

    expect(stable.graduationWindowSeconds).toBe(
      serverDraft.graduationWindowSeconds + WINDOW_DRIFT_TOLERANCE_SECONDS + 1
    );
    expect(stable.resolutionWindowSeconds).toBe(
      serverDraft.resolutionWindowSeconds + WINDOW_DRIFT_TOLERANCE_SECONDS + 1
    );
  });

  it("leaves writes without window fields alone", () => {
    const write: MarketDraftWrite = { question: "Only the question." };

    expect(stableWrite(write, marketDraftFactory())).toEqual({
      question: "Only the question.",
    });
  });
});

describe("writeChangesServerDraft", () => {
  it("reports no change when the write mirrors the stored draft", () => {
    const serverDraft = marketDraftFactory();

    expect(
      writeChangesServerDraft(writeFromServerDraft(serverDraft), serverDraft)
    ).toBe(false);
  });

  it("reports a change when a content field differs", () => {
    const serverDraft = marketDraftFactory();
    const write = {
      ...writeFromServerDraft(serverDraft),
      question: "Will something else happen?",
    };

    expect(writeChangesServerDraft(write, serverDraft)).toBe(true);
  });

  it("ignores window drift within the tolerance", () => {
    const serverDraft = marketDraftFactory();
    const write = {
      ...writeFromServerDraft(serverDraft),
      graduationWindowSeconds: serverDraft.graduationWindowSeconds + 30,
    };

    expect(writeChangesServerDraft(write, serverDraft)).toBe(false);
  });

  it("reports window moves beyond the tolerance", () => {
    const serverDraft = marketDraftFactory();
    const write = {
      ...writeFromServerDraft(serverDraft),
      resolutionWindowSeconds:
        serverDraft.resolutionWindowSeconds + WINDOW_DRIFT_TOLERANCE_SECONDS + 1,
    };

    expect(writeChangesServerDraft(write, serverDraft)).toBe(true);
  });
});

function localValue(date: Date) {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);

  return shifted.toISOString().slice(0, 16);
}

function writeFromServerDraft(
  serverDraft: ReturnType<typeof marketDraftFactory>
): MarketDraftWrite {
  return {
    category: serverDraft.category,
    description: serverDraft.description,
    graduationWindowSeconds: serverDraft.graduationWindowSeconds,
    liquidityParameter: serverDraft.liquidityParameter,
    openingProbability: serverDraft.openingProbability,
    outcomeNo: serverDraft.outcomeNo,
    outcomeYes: serverDraft.outcomeYes,
    question: serverDraft.question,
    resolutionCriteria: serverDraft.resolutionCriteria,
    resolutionSources: serverDraft.resolutionSources,
    resolutionUrl: serverDraft.resolutionUrl,
    resolutionWindowSeconds: serverDraft.resolutionWindowSeconds,
  };
}
