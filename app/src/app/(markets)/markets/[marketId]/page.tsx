import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getMarketById, getMarkets } from "@/domain/markets/queries";
import { MarketDetailPage } from "@/features/market-detail/market-detail-page";

type PageProps = {
  params: Promise<{ marketId: string }>;
};

export function generateStaticParams() {
  return getMarkets().map((market) => ({ marketId: market.id }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { marketId } = await params;
  const market = getMarketById(marketId);

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
  const market = getMarketById(marketId);

  if (!market) {
    notFound();
  }

  return <MarketDetailPage market={market} />;
}
