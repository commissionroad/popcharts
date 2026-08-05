import { describe, expect, it } from "bun:test";

import {
  COMPLETE_SET_PRICE_POLICY,
  tickToDisplayPriceWad,
} from "@popcharts/protocol";

import type { VenuePoolRow } from "./venue-orderbook";
import {
  displayPriceWadToCents,
  foldVenuePricePoints,
  type PoolPriceTickRow,
  venueOpeningPoint,
} from "./venue-price-history";

const WAD = 10n ** 18n;
const MOCK_DECIMALS = 18;
const YES_POOL_ID = `0x${"aa".repeat(32)}`;
const NO_POOL_ID = `0x${"bb".repeat(32)}`;
const GRADUATED_AT = new Date("2026-07-01T00:00:00.000Z");

/** Cents at a tick, via the same conversion the service uses. */
function centsAtTick(tick: number, outcomeIsCurrency0: boolean) {
  return displayPriceWadToCents(
    tickToDisplayPriceWad({
      collateralDecimals: MOCK_DECIMALS,
      outcomeDecimals: COMPLETE_SET_PRICE_POLICY.outcomeDecimals,
      outcomeIsCurrency0,
      tick,
    }),
  );
}

describe("displayPriceWadToCents", () => {
  it("reads a WAD display price as a cent-scale probability", () => {
    expect(displayPriceWadToCents(WAD / 2n)).toBe(50);
    expect(displayPriceWadToCents(0n)).toBe(0);
    expect(displayPriceWadToCents(WAD)).toBe(100);
    expect(displayPriceWadToCents((WAD * 37n) / 100n)).toBe(37);
  });

  it("keeps sub-cent movement instead of rounding it away", () => {
    // A bounded pool can take several swaps inside one cent. Rounding here
    // would collapse them to a flat line, and would stair-step the venue half
    // of a chart whose pre-graduation half plots fractional cents.
    expect(displayPriceWadToCents((WAD * 6249n) / 10_000n)).toBeCloseTo(
      62.49,
      6,
    );
    expect(displayPriceWadToCents((WAD * 6251n) / 10_000n)).toBeCloseTo(
      62.51,
      6,
    );
    expect(displayPriceWadToCents((WAD * 6249n) / 10_000n)).not.toBe(
      displayPriceWadToCents((WAD * 6251n) / 10_000n),
    );
  });
});

describe("venueOpeningPoint", () => {
  it("opens both pools where the pregrad book closed", () => {
    // Balanced shares at a 50% opening probability close at 50/50.
    const point = venueOpeningPoint(
      {
        liquidityParameter: 5_000n * WAD,
        noShares: 0n,
        openingProbabilityWad: WAD / 2n,
        yesShares: 0n,
      },
      GRADUATED_AT,
    );

    expect(point).toEqual({
      at: "2026-07-01T00:00:00.000Z",
      noPriceCents: 50,
      yesPriceCents: 50,
    });
  });

  it("gives NO the complement of the closing YES price", () => {
    // A YES-heavy book closes above 50%, and the pair still sums to a set.
    const point = venueOpeningPoint(
      {
        liquidityParameter: 1_000n * WAD,
        noShares: 0n,
        openingProbabilityWad: WAD / 2n,
        yesShares: 1_000n * WAD,
      },
      GRADUATED_AT,
    );

    expect(point.yesPriceCents).toBeGreaterThan(50);
    // Complementary to float precision: the pair is derived as WAD - yes, so
    // it sums to one complete set, not to exactly 100 in binary floating point.
    expect(point.yesPriceCents + point.noPriceCents).toBeCloseTo(100, 9);
  });
});

describe("foldVenuePricePoints", () => {
  const opening = {
    at: GRADUATED_AT.toISOString(),
    noPriceCents: 40,
    yesPriceCents: 60,
  };

  it("leads with the opening point when no swap has landed", () => {
    expect(
      foldVenuePricePoints({
        collateralDecimals: MOCK_DECIMALS,
        opening,
        ticks: [],
      }),
    ).toEqual([opening]);
  });

  it("carries the untouched pool's price forward across a swap", () => {
    const points = foldVenuePricePoints({
      collateralDecimals: MOCK_DECIMALS,
      opening,
      ticks: [
        {
          pool: createPoolRow({}),
          tick: createTickRow({ tick: -6960 }),
        },
      ],
    });

    // A YES swap re-prices YES only; NO still stands where it opened.
    expect(points).toHaveLength(2);
    expect(points[1]).toEqual({
      at: "2026-07-01T01:00:00.000Z",
      noPriceCents: 40,
      yesPriceCents: centsAtTick(-6960, true),
    });
  });

  it("tracks each pool independently as swaps alternate", () => {
    const points = foldVenuePricePoints({
      collateralDecimals: MOCK_DECIMALS,
      opening,
      ticks: [
        { pool: createPoolRow({}), tick: createTickRow({ tick: -6960 }) },
        {
          pool: createPoolRow({
            outcomeIsCurrency0: false,
            poolId: NO_POOL_ID,
            side: "no",
          }),
          tick: createTickRow({ logIndex: 2, poolId: NO_POOL_ID, tick: 6900 }),
        },
      ],
    });

    const yesCents = centsAtTick(-6960, true);

    // The NO swap leaves the YES price from the previous sample standing.
    expect(points[1]?.yesPriceCents).toBe(yesCents);
    expect(points[2]).toEqual({
      at: "2026-07-01T01:00:00.000Z",
      noPriceCents: centsAtTick(6900, false),
      yesPriceCents: yesCents,
    });
  });

  it("respects each pool's currency sort order", () => {
    // The same raw tick prices opposite ways depending on orientation, so a
    // pool row's flag — not the side — decides the conversion.
    const atTick = (outcomeIsCurrency0: boolean) =>
      foldVenuePricePoints({
        collateralDecimals: MOCK_DECIMALS,
        opening,
        ticks: [
          {
            pool: createPoolRow({ outcomeIsCurrency0 }),
            tick: createTickRow({ tick: -6960 }),
          },
        ],
      })[1]?.yesPriceCents;

    expect(atTick(true)).toBe(centsAtTick(-6960, true));
    expect(atTick(false)).toBe(centsAtTick(-6960, false));
    expect(atTick(true)).not.toBe(atTick(false));
  });
});

function createTickRow(overrides: Partial<PoolPriceTickRow>): PoolPriceTickRow {
  return {
    blockNumber: 1_000n,
    blockTimestamp: new Date("2026-07-01T01:00:00.000Z"),
    chainId: 31337,
    contractId: 1,
    createdAt: new Date("2026-07-01T01:00:01.000Z"),
    id: 1n,
    logIndex: 0,
    poolId: YES_POOL_ID,
    sequence: 1n,
    tick: 0,
    transactionHash: `0x${"dd".repeat(32)}`,
    ...overrides,
  };
}

function createPoolRow(overrides: Partial<VenuePoolRow>): VenuePoolRow {
  return {
    chainId: 31337,
    createdAt: GRADUATED_AT,
    id: 1,
    marketId: 7n,
    outcomeIsCurrency0: true,
    outcomeToken: "0x00000000000000000000000000000000000000e0",
    poolId: YES_POOL_ID,
    postgradMarket: "0x00000000000000000000000000000000000000f0",
    side: "yes",
    ...overrides,
  };
}
