import type { Metadata } from "next";

import { CreateDraftPage } from "@/features/market-create/create-draft-page";

export const metadata: Metadata = {
  title: "Create",
};

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ draft?: string }>;
};

export default async function Page({ searchParams }: PageProps) {
  const { draft } = await searchParams;
  const parsedDraftId = draft ? Number.parseInt(draft, 10) : Number.NaN;
  const initialDraftId = Number.isSafeInteger(parsedDraftId) ? parsedDraftId : null;

  return (
    <CreateDraftPage
      initialDraftId={initialDraftId}
      initialNow={new Date().toISOString()}
    />
  );
}
