"use client";

import { Clock } from "lucide-react";
import type { ReactNode } from "react";

import {
  formatDeadline,
  toDateTimeLocalValue,
} from "@/domain/market-creation/create-market";
import { cn } from "@/lib/cn";

/**
 * Label/value row used by the review, submitted, and success panels; `mono`
 * renders the value in a break-all monospace style for hashes and IDs.
 */
export function ReviewRow({
  label,
  mono,
  value,
}: {
  label: string;
  mono?: boolean;
  value: ReactNode;
}) {
  return (
    <div className="grid gap-1 px-3.5 py-3 sm:grid-cols-[0.45fr_1fr] sm:gap-3">
      <div className="font-mono text-[10px] tracking-[0.12em] text-[var(--text-muted)] uppercase">
        {label}
      </div>
      <div
        className={cn(
          "min-w-0 text-sm leading-5 text-[var(--text-primary)]",
          mono ? "font-mono text-[12px] break-all" : null
        )}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * Renders an on-chain deadline (seconds since epoch) as a clock icon plus the
 * draft-form deadline label, used by the review and success panels.
 */
export function formatDeadlineFromSeconds(value: bigint) {
  const date = new Date(Number(value) * 1000);
  return (
    <span className="inline-flex items-center gap-1.5">
      <Clock size={13} color="var(--text-muted)" />
      {formatDeadline(toDateTimeLocalValue(date))}
    </span>
  );
}
