import { resolveBoardStatusFilter } from "@/domain/markets/board-filters";
import { DiscoveryPage } from "@/features/market-discovery/discovery-page";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;

  return <DiscoveryPage statusFilter={resolveBoardStatusFilter(status)} />;
}
