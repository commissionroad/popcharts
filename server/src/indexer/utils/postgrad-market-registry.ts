import { config } from "src/config";
import { db, eq, schema } from "src/db/client";

/** One graduated postgrad market the resolution watcher should follow. */
export type IndexedPostgradMarket = {
  /** Lowercased CompleteSetBinaryMarket contract address. */
  address: string;
  marketId: bigint;
  /**
   * Block of the market's GraduationFinalized event. The market contract
   * deploys inside that transaction, so no MarketResolved/MarketCancelled log
   * can precede this block; it is the safe backfill start for a market that
   * has no cursor yet.
   */
  startBlock: bigint;
};

// Markets already discovered this process run, keyed by lowercased address.
// The resolution watcher re-reads this via getKnownPostgradMarket on every log
// to map a market contract back to its pregrad marketId.
const knownPostgradMarkets = new Map<string, IndexedPostgradMarket>();

/**
 * Refreshes the known postgrad-market set from GraduationFinalized events —
 * the same rows the resolution runner joins for its per-market address. The
 * watcher polls this to extend its subscription without a restart.
 */
export async function refreshPostgradMarketRegistry(
  dbc: typeof db = db,
): Promise<IndexedPostgradMarket[]> {
  const rows = await dbc
    .select({
      marketId: schema.graduationFinalizedEvents.marketId,
      postgradMarket: schema.graduationFinalizedEvents.postgradMarket,
      startBlock: schema.graduationFinalizedEvents.blockNumber,
    })
    .from(schema.graduationFinalizedEvents)
    .where(eq(schema.graduationFinalizedEvents.chainId, config.chainId));

  for (const row of rows) {
    const address = row.postgradMarket.toLowerCase();
    const existing = knownPostgradMarkets.get(address);

    // Keep the earliest graduation block if replays produced duplicate rows.
    if (!existing || row.startBlock < existing.startBlock) {
      knownPostgradMarkets.set(address, {
        address,
        marketId: row.marketId,
        startBlock: row.startBlock,
      });
    }
  }

  return [...knownPostgradMarkets.values()];
}

/** Looks up a discovered postgrad market by address (case-insensitive). */
export function getKnownPostgradMarket(
  address: string,
): IndexedPostgradMarket | undefined {
  return knownPostgradMarkets.get(address.toLowerCase());
}
