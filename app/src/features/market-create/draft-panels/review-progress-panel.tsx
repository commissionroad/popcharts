"use client";

import { Bot, FileSearch, Gauge, ShieldCheck } from "lucide-react";

/**
 * In-review sidebar: a lightweight animated state while the AI review runs.
 * The flow hook polls the draft and swaps this panel out the moment the
 * verdict lands, so this stays purely presentational.
 */
export function ReviewProgressPanel({ question }: { question: string }) {
  const steps = [
    { Icon: FileSearch, label: "Reading the question" },
    { Icon: ShieldCheck, label: "Checking policy & safety" },
    { Icon: Gauge, label: "Scoring resolvability" },
  ];

  return (
    <>
      <div className="flex flex-col gap-5 rounded-[var(--radius-lg)] border border-[var(--pc-cyan)] bg-[var(--surface-card)] p-6">
        <div className="flex items-center gap-2.5">
          <span className="relative flex size-8 items-center justify-center">
            <span className="absolute inset-0 animate-ping rounded-full bg-[var(--pc-cyan)] opacity-20" />
            <Bot className="relative" color="var(--pc-cyan)" size={20} />
          </span>
          <div>
            <div className="font-mono text-[10px] font-bold tracking-[0.14em] text-[var(--pc-cyan)] uppercase">
              AI review in progress
            </div>
            <div className="text-[12.5px] text-[var(--text-muted)]">
              Usually under a minute
            </div>
          </div>
        </div>
        <p className="font-display min-h-6 text-base leading-snug font-bold text-[var(--text-secondary)]">
          “{question}”
        </p>
        <ol className="flex flex-col gap-3">
          {steps.map(({ Icon, label }, index) => (
            <li className="flex items-center gap-3" key={label}>
              <span
                className="flex size-6 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-raised)]"
                style={{ animationDelay: `${index * 300}ms` }}
              >
                <Icon className="animate-pulse" color="var(--pc-cyan)" size={13} />
              </span>
              <span className="text-[13px] text-[var(--text-secondary)]">{label}</span>
            </li>
          ))}
        </ol>
      </div>
      <span className="text-center font-mono text-[11px] text-[var(--text-muted)]">
        Your draft is locked while the reviewer reads it
      </span>
    </>
  );
}
