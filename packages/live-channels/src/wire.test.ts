// The live-updates frame contract (repo ADR 0021). The round-trip test is the
// one that earns its keep: it is the only place the serialize and parse
// directions are checked against each other, which is the drift this package
// exists to prevent.
import { describe, expect, it } from "bun:test";

import {
  RESET_REASON_CURSOR_TOO_OLD,
  parseChangeSignal,
  parseResetReason,
  serializeChangeSignal,
  type ChangeSignalSource,
} from "./wire";

function event(
  overrides: Partial<ChangeSignalSource> = {},
): ChangeSignalSource {
  return {
    id: 12n,
    channels: ["market:31337:42", "markets"],
    sourceTable: "receipt_placed_events",
    op: "insert",
    chainId: 31337,
    marketId: "42",
    owner: "0x00000000000000000000000000000000000000aa",
    blockNumber: 100n,
    logIndex: 3,
    ...overrides,
  };
}

describe("serializeChangeSignal", () => {
  it("stringifies the bigints JSON cannot carry", () => {
    const wire = serializeChangeSignal(event({ id: 9007199254740993n }));

    // Past Number.MAX_SAFE_INTEGER: the string must survive exactly, since it
    // is the resume cursor.
    expect(wire.id).toBe("9007199254740993");
    expect(wire.blockNumber).toBe("100");
  });

  it("keeps a null blockNumber null rather than the string 'null'", () => {
    expect(
      serializeChangeSignal(event({ blockNumber: null })).blockNumber,
    ).toBeNull();
  });

  it("publishes the source table under its wire name", () => {
    expect(serializeChangeSignal(event()).source).toBe("receipt_placed_events");
  });
});

describe("the serialize/parse round trip", () => {
  it("survives JSON with every field intact", () => {
    const wire = serializeChangeSignal(event());

    const parsed = parseChangeSignal(JSON.parse(JSON.stringify(wire)));

    expect(parsed).toEqual(wire);
  });

  it("survives a fully-null row", () => {
    const wire = serializeChangeSignal(
      event({
        chainId: null,
        marketId: null,
        owner: null,
        blockNumber: null,
        logIndex: null,
      }),
    );

    expect(parseChangeSignal(JSON.parse(JSON.stringify(wire)))).toEqual(wire);
  });
});

describe("parseChangeSignal", () => {
  it("drops a frame with no usable id, which cannot be deduped or resumed from", () => {
    expect(parseChangeSignal({ channels: ["markets"] })).toBeNull();
    expect(parseChangeSignal({ id: 12, channels: [] })).toBeNull();
    expect(parseChangeSignal(null)).toBeNull();
    expect(parseChangeSignal("not-a-frame")).toBeNull();
  });

  it("degrades every other field rather than discarding a real signal", () => {
    expect(
      parseChangeSignal({ id: "3", channels: "markets", source: 42 }),
    ).toEqual({
      id: "3",
      channels: [],
      source: "",
      op: "",
      chainId: null,
      marketId: null,
      owner: null,
      blockNumber: null,
      logIndex: null,
    });
  });

  it("keeps the usable channels out of a mixed array", () => {
    const parsed = parseChangeSignal({
      id: "3",
      channels: ["markets", 7, null],
    });

    expect(parsed?.channels).toEqual(["markets"]);
  });
});

describe("parseResetReason", () => {
  it("reads the server's reason", () => {
    expect(parseResetReason({ reason: "retention-window" })).toBe(
      "retention-window",
    );
  });

  it("falls back when the payload is unusable, since a reset is actionable without it", () => {
    expect(parseResetReason({})).toBe(RESET_REASON_CURSOR_TOO_OLD);
    expect(parseResetReason(null)).toBe(RESET_REASON_CURSOR_TOO_OLD);
    expect(parseResetReason({ reason: 7 })).toBe(RESET_REASON_CURSOR_TOO_OLD);
  });
});
