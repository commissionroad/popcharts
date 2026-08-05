import type { Metadata } from "next";

import { CreateDraftPage } from "@/features/market-create/create-draft-page";
import { readDraftIdParam } from "@/lib/draft-url";

export const metadata: Metadata = {
  title: "Create",
};

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ draft?: string }>;
};

export default async function Page({ searchParams }: PageProps) {
  const { draft } = await searchParams;

  return (
    <CreateDraftPage
      initialDraftId={readDraftIdParam(draft)}
      initialNow={new Date().toISOString()}
    />
  );
}
