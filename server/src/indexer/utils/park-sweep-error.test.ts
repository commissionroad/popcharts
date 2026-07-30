// A census, not a unit test. The watcher decides whether to park or abandon
// the pass by `instanceof ParkSweepError`, so an error that means "not yet"
// but forgets the base class silently gets the harshest possible handling —
// and nothing else in the suite would notice, because each error's own tests
// only assert that it throws. Every prerequisite-race error the indexer
// defines belongs here.
import { describe, expect, it } from "bun:test";

import {
  MarketNotIndexedError,
  MarketStatusOutOfOrderError,
} from "src/indexer/handlers/market-projection";
import { VenueOrderNotIndexedError } from "src/indexer/handlers/venue-orders";
import { ParkSweepError } from "src/indexer/utils/park-sweep-error";

const PARKABLE = [
  {
    build: () => new MarketNotIndexedError({ chainId: 31337, marketId: 7n }),
    name: "MarketNotIndexedError",
    why: "the markets row has not been indexed yet",
  },
  {
    build: () =>
      new MarketStatusOutOfOrderError({
        chainId: 31337,
        current: "bootstrap",
        marketId: 7n,
        transition: {
          atOrPast: ["resolved"],
          from: ["graduated"],
          to: "disputed",
        },
      }),
    name: "MarketStatusOutOfOrderError",
    why: "the market's status cannot accept this event yet",
  },
  {
    build: () =>
      new VenueOrderNotIndexedError({
        chainId: 31337,
        orderId: 1,
        poolId: "0x00000000000000000000000000000000000000ee",
      }),
    name: "VenueOrderNotIndexedError",
    why: "the venue_orders row has not been indexed yet",
  },
];

describe("parkable indexer errors", () => {
  for (const { build, name, why } of PARKABLE) {
    it(`parks the sweep for ${name}, because ${why}`, () => {
      expect(build()).toBeInstanceOf(ParkSweepError);
    });

    it(`reports its own name for ${name}`, () => {
      // The watcher logs `name` when it parks; inheriting a bare "Error" would
      // make every parked contract look identical in the log group.
      expect(build().name).toBe(name);
    });
  }
});
