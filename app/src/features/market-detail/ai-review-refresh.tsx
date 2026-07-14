"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const REVIEW_REFRESH_MS = 2_000;

/** Refreshes server-rendered market data only while review work is pending. */
export function AiReviewRefresh() {
  const router = useRouter();

  useEffect(() => {
    const interval = window.setInterval(() => router.refresh(), REVIEW_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [router]);

  return null;
}
