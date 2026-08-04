import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  getMarketById,
  getMarketPricePath,
  getMarkets,
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
  // One read covers the chart's whole life (repo ADR 0025): the server owns
  // the LMSR replay and the venue prices, so the page no longer fetches raw
  // receipts or replays anything itself. A failed or empty history falls back
  // to the market's own synthetic path inside MarketDetailPage.
  const [market, pricePath] = await Promise.all([
    getMarketById(marketId),
    getMarketPricePath(marketId),
  ]);

  if (!market) {
    notFound();
  }

  return (
    <MarketDetailPage
      market={market}
      {...(pricePath.length > 0 ? { pricePath } : {})}
    />
  );
}
