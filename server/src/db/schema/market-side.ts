import type { MARKET_SIDES } from "@popcharts/protocol";

/**
 * The "yes"/"no" side labels, for the Postgres enums that store them.
 *
 * Unlike every other literal set in this directory, this deliberately does
 * NOT spread `@popcharts/protocol`'s `MARKET_SIDES`. drizzle-kit 0.30 bundles
 * the schema graph with esbuild 0.19, which predates ES2023 support, so any
 * *value* import from the protocol workspace under `src/db/schema` makes
 * `db:generate` die with `Invalid target "es2023"` when it reads that
 * workspace's tsconfig. The type-only import above is erased before bundling,
 * so it costs nothing at build time while still tying this list to the
 * protocol.
 *
 * `satisfies typeof MARKET_SIDES` is what makes that tie total: matching the
 * array's *type* rather than `readonly MarketSide[]` pins the exact tuple, so
 * an addition, removal, rename, reorder, or duplicate upstream all fail to
 * compile here. A `readonly MarketSide[]` bound would only have caught
 * removals and renames, letting a newly added side silently skip these enums.
 *
 * Bumping drizzle-kit past its esbuild 0.19 pin would let this spread
 * `MARKET_SIDES` directly, like the other sets do.
 */
export const MARKET_SIDE_VALUES = [
  "yes",
  "no",
] as const satisfies typeof MARKET_SIDES;
