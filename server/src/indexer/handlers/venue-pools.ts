import {
  buildOutcomePoolKey,
  computePoolId,
  type MarketSide,
} from "@popcharts/protocol";

import type { LiveChangeWriter } from "src/change-feed/writer";
import { and, db, eq, schema } from "src/db/client";

/** Insert shape for one outcome pool's `venue_pools` row. */
export type VenuePoolRecord = typeof schema.venuePools.$inferInsert;

/**
 * Computes the two venue_pools rows (YES and NO) for a postgrad market from
 * the same deterministic pool-key policy the graduation wiring applies
 * (ADR 0007/0009), so the mapping can be rebuilt at any time without an
 * on-chain registration event. Every input the pool ids hash — the bounded
 * hook included — is an argument, so a rebuild depends only on what the caller
 * passes and never on process config.
 */
export function buildVenuePoolRecords({
  boundedHook,
  chainId,
  collateral,
  marketId,
  noToken,
  postgradMarket,
  yesToken,
}: {
  readonly boundedHook: `0x${string}`;
  readonly chainId: number;
  readonly collateral: `0x${string}`;
  readonly marketId: bigint;
  readonly noToken: `0x${string}`;
  readonly postgradMarket: `0x${string}`;
  readonly yesToken: `0x${string}`;
}): VenuePoolRecord[] {
  const build = (token: `0x${string}`, side: MarketSide): VenuePoolRecord => {
    // ABI-encoding an address only uses its 20 bytes, so lowercasing here
    // keeps the pool id identical while accepting non-checksummed input.
    const outcomeToken = token.toLowerCase() as `0x${string}`;
    const { key, outcomeIsCurrency0 } = buildOutcomePoolKey({
      boundedHook: boundedHook.toLowerCase() as `0x${string}`,
      collateral: collateral.toLowerCase() as `0x${string}`,
      outcomeToken,
    });

    return {
      chainId,
      marketId,
      outcomeIsCurrency0,
      outcomeToken,
      poolId: computePoolId(key).toLowerCase(),
      postgradMarket: postgradMarket.toLowerCase(),
      side,
    };
  };

  return [build(yesToken, "yes"), build(noToken, "no")];
}

/**
 * Inserts venue pool mappings, ignoring rows already registered so eager
 * (GraduationFinalized) and lazy (first order event) registration paths can
 * both run without conflicting.
 */
export async function persistVenuePoolRecords(
  records: VenuePoolRecord[],
  dbc: typeof db = db,
) {
  await dbc.insert(schema.venuePools).values(records).onConflictDoNothing();
}

/**
 * Resolves which graduated market a venue pool trades, for routing pool-keyed
 * events to the market's live channel (repo ADR 0021). The mapping is
 * best-effort by design (see ensureVenuePoolIndexed), so callers must treat
 * null as "no market channel to signal", not as an error.
 */
export async function findVenuePoolMarketId(
  dbc: LiveChangeWriter,
  { chainId, poolId }: { chainId: number; poolId: string },
): Promise<bigint | null> {
  const pool = await dbc.query.venuePools.findFirst({
    columns: { marketId: true },
    where: and(
      eq(schema.venuePools.chainId, chainId),
      eq(schema.venuePools.poolId, poolId),
    ),
  });

  return pool?.marketId ?? null;
}
