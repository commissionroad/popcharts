import type { Metadata } from "next";

import { StudioPage } from "@/features/creator-studio/studio-page";

export const metadata: Metadata = {
  title: "Studio",
};

export const dynamic = "force-dynamic";

export default function Page() {
  return <StudioPage />;
}
