import type { CSSProperties } from "react";

import type { MarketStatus } from "@/domain/markets/types";
import { cn } from "@/lib/cn";

const STATUS: Record<MarketStatus, { color: string; label: string; pulse: boolean }> = {
  bootstrap: {
    color: "var(--status-bootstrap)",
    label: "Bootstrap",
    pulse: true,
  },
  cancelled: {
    color: "var(--status-refunded)",
    label: "Cancelled",
    pulse: false,
  },
  graduated: {
    color: "var(--status-graduated)",
    label: "Graduated",
    pulse: false,
  },
  graduating: {
    color: "var(--status-graduating)",
    label: "Graduating",
    pulse: true,
  },
  refunded: {
    color: "var(--status-refunded)",
    label: "Refunded",
    pulse: false,
  },
  resolved: {
    color: "var(--status-resolved)",
    label: "Resolved",
    pulse: false,
  },
};

export function StatusPill({
  className,
  label,
  size = "md",
  status,
}: {
  className?: string;
  label?: string;
  size?: "sm" | "md";
  status: MarketStatus;
}) {
  const state = STATUS[status];
  const style = { "--status-color": state.color } as CSSProperties;

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[var(--radius-pill)] border border-[var(--status-color)] font-mono tracking-[0.1em] text-[var(--status-color)] uppercase",
        size === "sm"
          ? "gap-1.5 px-2.5 py-1 text-[10px]"
          : "gap-2 px-3 py-1.5 text-[11px]",
        className
      )}
      style={style}
    >
      <span
        className={cn(
          "size-1.5 rounded-[var(--radius-pill)] bg-current",
          state.pulse ? "animate-[pc-pulse_1.8s_ease-in-out_infinite]" : null
        )}
      />
      {label ?? state.label}
    </span>
  );
}
