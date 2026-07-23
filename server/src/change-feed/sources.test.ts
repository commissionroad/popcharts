// The registry contract for the live-updates change feed (repo ADR 0021): every
// registered source routes somewhere and routing never invents a channel from
// missing columns. That every source is also reached by a real write seam (the
// completeness the removed trigger gave for free) is proven behaviourally in
// change-feed-writer.pglite.test.ts.
import {
  MARKET_LIST_CHANNEL,
  marketChannel,
  portfolioChannel,
} from "@popcharts/live-channels";
import { describe, expect, it } from "bun:test";

import {
  CHANGE_FEED_SOURCES,
  changeFeedRowToEvent,
  channelsForRow,
  type ChangeFeedRow,
} from "src/change-feed/sources";

function row(overrides: Partial<ChangeFeedRow> = {}): ChangeFeedRow {
  return {
    id: 1n,
    createdAt: new Date("2026-07-17T00:00:00Z"),
    sourceTable: "receipt_placed_events",
    op: "insert",
    rowId: "1",
    chainId: 31337,
    marketId: "42",
    owner: "0x00000000000000000000000000000000000000aa",
    blockNumber: 100n,
    logIndex: 0,
    ...overrides,
  };
}

describe("change feed registry", () => {
  it("gives every source a valid op and at least one route", () => {
    for (const [table, source] of Object.entries(CHANGE_FEED_SOURCES)) {
      expect(["insert", "update"], table).toContain(source.op);
      expect(source.routes.length, table).toBeGreaterThan(0);
    }
  });

  it("resolves every source to at least one channel for a fully-populated row", () => {
    for (const [table, source] of Object.entries(CHANGE_FEED_SOURCES)) {
      const channels = channelsForRow(row(), source.routes);
      expect(channels.length, table).toBeGreaterThan(0);
    }
  });

  it("builds channels only from present routing columns", () => {
    expect(channelsForRow(row(), ["market"])).toEqual([
      marketChannel(31337, "42"),
    ]);
    expect(channelsForRow(row(), ["owner"])).toEqual([
      portfolioChannel("0x00000000000000000000000000000000000000aa"),
    ]);
    expect(channelsForRow(row(), ["market-list"])).toEqual([
      MARKET_LIST_CHANNEL,
    ]);

    // Missing keying columns contribute nothing rather than a bogus channel.
    expect(channelsForRow(row({ marketId: null }), ["market"])).toEqual([]);
    expect(channelsForRow(row({ owner: null }), ["owner"])).toEqual([]);
  });

  it("lower-cases the portfolio channel so subscriptions match any casing", () => {
    expect(portfolioChannel("0xABC")).toBe("portfolio:0xabc");
  });

  it("maps a known row to an event and drops unknown/unroutable rows", () => {
    const event = changeFeedRowToEvent(row());
    expect(event).not.toBeNull();
    expect(event!.channels).toContain(marketChannel(31337, "42"));

    expect(
      changeFeedRowToEvent(row({ sourceTable: "not_a_source" })),
    ).toBeNull();
    // A market-only source with no market id resolves to zero channels → dropped.
    expect(
      changeFeedRowToEvent(
        row({ sourceTable: "clearing_root_submitted_events", marketId: null }),
      ),
    ).toBeNull();
  });
});
