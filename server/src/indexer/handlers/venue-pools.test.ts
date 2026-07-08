import { describe, expect, it } from "bun:test";

import { buildVenuePoolRecords, persistVenuePoolRecords } from "./venue-pools";

// The outcome tokens straddle the collateral address so the two pools sort
// their currencies differently, exercising both outcomeIsCurrency0 branches.
const collateral = "0x00000000000000000000000000000000000000CC" as const;
const yesToken = "0x00000000000000000000000000000000000000AA" as const;
const noToken = "0x00000000000000000000000000000000000000EE" as const;
const postgradMarket = "0x00000000000000000000000000000000000000DD" as const;

describe("buildVenuePoolRecords", () => {
  const records = buildVenuePoolRecords({
    chainId: 5042002,
    collateral,
    marketId: 7n,
    noToken,
    postgradMarket,
    yesToken,
  });

  it("derives one row per outcome side with normalized addresses", () => {
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      chainId: 5042002,
      marketId: 7n,
      outcomeIsCurrency0: true,
      outcomeToken: yesToken.toLowerCase(),
      postgradMarket: postgradMarket.toLowerCase(),
      side: "yes",
    });
    expect(records[1]).toMatchObject({
      marketId: 7n,
      outcomeIsCurrency0: false,
      outcomeToken: noToken.toLowerCase(),
      side: "no",
    });
  });

  it("computes distinct, deterministic 32-byte pool ids", () => {
    expect(records[0]!.poolId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(records[1]!.poolId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(records[0]!.poolId).not.toBe(records[1]!.poolId);

    const rebuilt = buildVenuePoolRecords({
      chainId: 5042002,
      collateral,
      marketId: 7n,
      noToken,
      postgradMarket,
      yesToken,
    });

    expect(rebuilt.map((record) => record.poolId)).toEqual(
      records.map((record) => record.poolId),
    );
  });
});

describe("persistVenuePoolRecords", () => {
  it("inserts with conflict-ignore so re-registration is idempotent", async () => {
    const inserted: unknown[] = [];
    let conflictIgnored = false;
    const dbc = {
      insert: () => ({
        values: (values: unknown) => {
          inserted.push(values);
          return {
            onConflictDoNothing: async () => {
              conflictIgnored = true;
            },
          };
        },
      }),
    } as unknown as Parameters<typeof persistVenuePoolRecords>[1];

    const records = buildVenuePoolRecords({
      chainId: 5042002,
      collateral,
      marketId: 7n,
      noToken,
      postgradMarket,
      yesToken,
    });
    await persistVenuePoolRecords(records, dbc);

    expect(inserted).toEqual([records]);
    expect(conflictIgnored).toBe(true);
  });
});
