import { AlertTriangle, LoaderCircle, Sparkles } from "lucide-react";

import type { AiReviewProgress } from "@/domain/markets/types";

const PENDING_COPY: Record<
  Extract<
    AiReviewProgress["phase"],
    "awaiting_queue" | "queued" | "running" | "retrying"
  >,
  string
> = {
  awaiting_queue: "Preparing this market for review.",
  queued: "Waiting for the reviewer to start.",
  running: "Checking the market criteria and public evidence.",
  retrying: "The reviewer is retrying after a temporary interruption.",
};

export function AiReviewProgressCard({ progress }: { progress: AiReviewProgress }) {
  const needsAttention = progress.status === "attention_required";
  const copy = needsAttention
    ? "Review could not finish after several attempts. The market remains locked until an operator retries it."
    : (PENDING_COPY[progress.phase as keyof typeof PENDING_COPY] ??
      "Review is still in progress.");

  return (
    <div
      className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)] p-5"
      role={needsAttention ? "alert" : "status"}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.14em] text-[var(--text-muted)] uppercase">
          <Sparkles size={14} />
          AI review
        </div>
        <span
          className={`inline-flex items-center gap-2 rounded-[var(--radius-pill)] border px-3 py-1.5 font-mono text-[11px] tracking-[0.1em] uppercase ${
            needsAttention
              ? "border-[var(--pc-amber)] text-[var(--pc-amber)]"
              : "border-[var(--pc-cyan)] text-[var(--pc-cyan)]"
          }`}
        >
          {needsAttention ? (
            <AlertTriangle size={13} />
          ) : (
            <LoaderCircle className="animate-spin" size={13} />
          )}
          {needsAttention ? "Review delayed" : "Review pending"}
        </span>
      </div>
      <p className="mt-4 max-w-2xl text-[13px] leading-6 text-[var(--text-secondary)]">
        {copy}
      </p>
      {!needsAttention ? (
        <p className="mt-2 font-mono text-[10px] tracking-[0.08em] text-[var(--text-muted)] uppercase">
          This page will update when the review is complete.
        </p>
      ) : null}
    </div>
  );
}
