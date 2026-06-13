import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getMarketById, getMarkets } from "@/domain/markets/queries";
import { GraduationPage } from "@/features/graduation-clearing/graduation-page";

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
    return { title: "Graduation not found" };
  }

  return {
    description: "Band-pass clearing view for a Pop Charts market.",
    title: `Graduation - ${market.question}`,
  };
}

export default async function Page({ params }: PageProps) {
  const { marketId } = await params;
  const market = getMarketById(marketId);

  if (!market) {
    notFound();
  }

  return <GraduationPage market={market} />;
}
