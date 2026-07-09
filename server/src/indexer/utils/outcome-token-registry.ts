import { config } from "src/config";
import { and, db, eq, schema } from "src/db/client";

/** One graduated outcome token the transfer watcher should follow. */
export type IndexedOutcomeToken = {
  /** Lowercased token contract address. */
  address: string;
  marketId: bigint;
  side: "yes" | "no";
  /**
   * Block of the market's GraduationFinalized event. OutcomeToken minting is
   * market-only and the market deploys at graduation, so no transfer can
   * precede this block; it is the safe backfill start for a token that has no
   * cursor yet.
   */
  startBlock: bigint;
};

// Tokens already discovered this process run, keyed by lowercased address.
// The transfer watcher re-reads this via getKnownOutcomeToken on every log to
// map a token back to its market and side.
const knownOutcomeTokens = new Map<string, IndexedOutcomeToken>();

/**
 * Refreshes the known outcome-token set from venue_pools joined to each
 * market's GraduationFinalized event. venue_pools rows are written when
 * graduation finalizes (eagerly) or on the first venue order event (lazily),
 * so every token appears here shortly after its market graduates; the watcher
 * polls this to extend its subscription without a restart.
 */
export async function refreshOutcomeTokenRegistry(
  dbc: typeof db = db,
): Promise<IndexedOutcomeToken[]> {
  const rows = await dbc
    .select({
      marketId: schema.venuePools.marketId,
      outcomeToken: schema.venuePools.outcomeToken,
      side: schema.venuePools.side,
      startBlock: schema.graduationFinalizedEvents.blockNumber,
    })
    .from(schema.venuePools)
    .innerJoin(
      schema.graduationFinalizedEvents,
      and(
        eq(schema.graduationFinalizedEvents.chainId, schema.venuePools.chainId),
        eq(
          schema.graduationFinalizedEvents.marketId,
          schema.venuePools.marketId,
        ),
      ),
    )
    .where(eq(schema.venuePools.chainId, config.chainId));

  for (const row of rows) {
    const address = row.outcomeToken.toLowerCase();
    const existing = knownOutcomeTokens.get(address);

    // Keep the earliest graduation block if replays produced duplicate rows.
    if (!existing || row.startBlock < existing.startBlock) {
      knownOutcomeTokens.set(address, {
        address,
        marketId: row.marketId,
        side: row.side,
        startBlock: row.startBlock,
      });
    }
  }

  return [...knownOutcomeTokens.values()];
}

/** Looks up a discovered token by address (case-insensitive). */
export function getKnownOutcomeToken(
  address: string,
): IndexedOutcomeToken | undefined {
  return knownOutcomeTokens.get(address.toLowerCase());
}
