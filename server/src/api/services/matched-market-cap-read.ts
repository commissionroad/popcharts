import { and, db, eq, or, schema } from "src/db/client";

import {
  calculateMatchedMarketCap,
  type ReceiptBand,
} from "./matched-market-cap";

export type MatchedMarketCapMarket = Pick<
  typeof schema.markets.$inferSelect,
  "chainId" | "contractId" | "marketId"
>;

export async function getMatchedMarketCap(market: MatchedMarketCapMarket) {
  const matchedMarketCaps = await getMatchedMarketCaps([market]);

  return matchedMarketCaps.get(marketKey(market)) ?? 0n;
}

export async function getMatchedMarketCaps(
  markets: MatchedMarketCapMarket[],
) {
  const matchedMarketCaps = new Map<string, bigint>();

  if (markets.length === 0) {
    return matchedMarketCaps;
  }

  const receiptConditions = markets.map((market) =>
    and(
      eq(schema.receiptPlacedEvents.chainId, market.chainId),
      eq(schema.receiptPlacedEvents.contractId, market.contractId),
      eq(schema.receiptPlacedEvents.marketId, market.marketId),
    ),
  );
  const receiptRows = await db
    .select({
      chainId: schema.receiptPlacedEvents.chainId,
      contractId: schema.receiptPlacedEvents.contractId,
      marketId: schema.receiptPlacedEvents.marketId,
      rHigh: schema.receiptPlacedEvents.rHigh,
      rLow: schema.receiptPlacedEvents.rLow,
      side: schema.receiptPlacedEvents.side,
    })
    .from(schema.receiptPlacedEvents)
    .where(
      receiptConditions.length === 1
        ? receiptConditions[0]
        : or(...receiptConditions),
    );

  const receiptsByMarket = new Map<string, ReceiptBand[]>();
  for (const receipt of receiptRows) {
    const key = marketKey(receipt);
    const receipts = receiptsByMarket.get(key) ?? [];
    receipts.push(receipt);
    receiptsByMarket.set(key, receipts);
  }

  for (const market of markets) {
    const key = marketKey(market);
    matchedMarketCaps.set(
      key,
      calculateMatchedMarketCap(receiptsByMarket.get(key) ?? []),
    );
  }

  return matchedMarketCaps;
}

function marketKey({
  chainId,
  contractId,
  marketId,
}: MatchedMarketCapMarket) {
  return `${chainId}:${contractId}:${marketId.toString()}`;
}
