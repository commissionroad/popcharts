import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { pricePathFromReceipts } from "@/domain/markets/api-market";
import {
  getMarketById,
  getMarketReceipts,
  getMarkets,
  getMarketVenuePricePath,
} from "@/domain/markets/queries";
import { MarketDetailPage } from "@/features/market-detail/market-detail-page";

type PageProps = {
  params: Promise<{ marketId: string }>;
};

export async function generateStaticParams() {
  const markets = await getMarkets();

  return markets.map((market) => ({ marketId: market.id }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { marketId } = await params;
  const market = await getMarketById(marketId);

  if (!market) {
    return { title: "Market not found" };
  }

  return {
    description: market.description,
    title: market.question,
  };
}

export default async function Page({ params }: PageProps) {
  const { marketId } = await params;
  // The venue history is fetched unconditionally alongside the receipts rather
  // than after checking the market's status: it is the same round trip either
  // way, and gating on status would serialize two requests to save a read that
  // answers with an empty list for every market that has not graduated.
  const [market, receipts, venuePricePath] = await Promise.all([
    getMarketById(marketId),
    getMarketReceipts(marketId),
    getMarketVenuePricePath(marketId),
  ]);

  if (!market) {
    notFound();
  }

  const pricePath =
    receipts.length > 0 ? pricePathFromReceipts(market, receipts) : null;

  return (
    <MarketDetailPage
      market={market}
      {...(pricePath ? { pricePath } : {})}
      {...(venuePricePath.length > 0 ? { venuePricePath } : {})}
    />
  );
}
