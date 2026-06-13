import type { CSSProperties } from "react";

import { cn } from "@/lib/cn";

export type SegmentOption = {
  label: string;
  value: string;
};

export function SegmentedControl({
  accentBy,
  className,
  full,
  onChange,
  options,
  size = "md",
  value,
}: {
  accentBy?: (value: string) => string;
  className?: string;
  full?: boolean;
  onChange: (value: string) => void;
  options: SegmentOption[];
  size?: "sm" | "md";
  value: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex max-w-full flex-wrap gap-1 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-raised)] p-1",
        full ? "w-full" : null,
        className
      )}
    >
      {options.map((option) => {
        const selected = option.value === value;
        const accent = accentBy?.(option.value) ?? "var(--accent)";
        const style = { "--segment-accent": accent } as CSSProperties;

        return (
          <button
            className={cn(
              "focus-ring font-display rounded-[var(--radius-sm)] border border-transparent font-bold transition-colors duration-[var(--duration-fast)]",
              full ? "flex-1" : null,
              size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2.5 text-sm",
              selected
                ? "bg-[var(--segment-accent)] text-[var(--pc-ink)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            )}
            key={option.value}
            onClick={() => onChange(option.value)}
            style={style}
            type="button"
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
