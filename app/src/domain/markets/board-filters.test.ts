import { describe, expect, it } from "vitest";

import {
  BOARD_STATUS_FILTERS,
  DEFAULT_BOARD_STATUS_FILTER,
  resolveBoardStatusFilter,
} from "./board-filters";

describe("board status filters", () => {
  it("resolves a known key to its view", () => {
    expect(resolveBoardStatusFilter("resolving")).toMatchObject({
      key: "resolving",
      statuses: ["resolution_pending", "disputed"],
    });
  });

  it("degrades unknown and absent keys to the All view", () => {
    expect(resolveBoardStatusFilter("not-a-view")).toBe(DEFAULT_BOARD_STATUS_FILTER);
    expect(resolveBoardStatusFilter(undefined)).toBe(DEFAULT_BOARD_STATUS_FILTER);
  });

  it("keeps chip keys unique, with the unfiltered All view first", () => {
    const keys = BOARD_STATUS_FILTERS.map((filter) => filter.key);

    expect(new Set(keys).size).toBe(keys.length);
    expect(BOARD_STATUS_FILTERS[0]).toBe(DEFAULT_BOARD_STATUS_FILTER);
    expect(DEFAULT_BOARD_STATUS_FILTER.statuses).toEqual([]);
  });
});
