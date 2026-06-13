import Link from "next/link";
import type { CSSProperties } from "react";

import type { MarketSide } from "@/domain/markets/types";
import { formatCents } from "@/lib/format";

export function OutcomeButton({
  href,
  priceCents,
  selected,
  side,
  sub,
}: {
  href?: string;
  priceCents: number;
  selected?: boolean;
  side: MarketSide;
  sub?: string;
}) {
  const isYes = side === "yes";
  const color = isYes ? "var(--yes)" : "var(--no)";
  const border = isYes ? "var(--yes-border)" : "var(--no-border)";
  const label = isYes ? "YES" : "NO";
  const className =
    "focus-ring flex flex-1 flex-col items-start gap-1 rounded-[var(--radius-md)] border p-3.5 text-left transition-colors duration-[var(--duration-fast)] hover:border-[var(--outcome-color)]";
  const style = {
    "--outcome-border": border,
    "--outcome-color": color,
  } as CSSProperties;
  const content = (
    <>
      <span
        className="font-mono text-xs font-bold tracking-[0.06em]"
        style={{ color: selected ? "var(--pc-ink)" : color }}
      >
        {label}
      </span>
      <span
        className="font-display tabular text-[26px] font-black"
        style={{ color: selected ? "var(--pc-ink)" : color }}
      >
        {formatCents(priceCents)}
      </span>
      {sub ? (
        <span className="font-mono text-[10px] text-[var(--text-muted)]">{sub}</span>
      ) : null}
    </>
  );

  if (href) {
    return (
      <Link
        className={className}
        href={href}
        style={{
          ...style,
          background: selected ? color : "var(--surface-raised)",
          borderColor: selected ? color : border,
        }}
      >
        {content}
      </Link>
    );
  }

  return (
    <div
      className={className}
      style={{
        ...style,
        background: selected ? color : "var(--surface-raised)",
        borderColor: selected ? color : border,
      }}
    >
      {content}
    </div>
  );
}
