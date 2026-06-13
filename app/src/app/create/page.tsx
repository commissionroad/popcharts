import type { Metadata } from "next";

import { CreateMarketPage } from "@/features/market-create/create-market-page";

export const metadata: Metadata = {
  title: "Create",
};

export const dynamic = "force-dynamic";

export default function Page() {
  return <CreateMarketPage initialNow={new Date().toISOString()} />;
}
