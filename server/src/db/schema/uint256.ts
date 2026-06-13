import { customType } from "drizzle-orm/pg-core";

// EVM amounts and counters are uint256. Postgres bigint is signed int64, so it
// overflows for normal WAD-scaled protocol values such as 5_000e18. Store these
// columns as numeric(78, 0), the decimal width needed for the full uint256 range,
// while exposing bigint to TypeScript callers.
export const uint256 = customType<{
  data: bigint;
  driverData: string;
}>({
  dataType() {
    return "numeric(78, 0)";
  },
  fromDriver(value) {
    // postgres returns numeric columns as strings; map back to bigint at the
    // schema boundary so indexer/API code can treat protocol integers naturally.
    return BigInt(value);
  },
  toDriver(value) {
    // Send strings to avoid driver-side number coercion and precision loss.
    return value.toString();
  },
});
