import Link from "next/link";

import { GraduationBar } from "@/components/ui/graduation-bar";
import { OutcomeButton } from "@/components/ui/outcome-button";
import { StatusPill } from "@/components/ui/status-pill";
import type { Market, MarketCategory } from "@/domain/markets/types";
import { formatB, formatUsdCompact } from "@/lib/format";

const categoryColor: Record<MarketCategory, string> = {
  Crypto: "var(--pc-cyan)",
  Culture: "var(--pc-amber)",
  Econ: "var(--pc-amber)",
  Politics: "var(--pc-violet)",
  Sports: "var(--pc-lime)",
  Tech: "var(--pc-cyan)",
};

export function MarketCard({ market }: { market: Market }) {
  const live = market.status === "bootstrap" || market.status === "graduating";

  return (
    <article className="group flex min-h-[360px] flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)] p-6 transition-[border-color,transform] duration-[var(--duration-fast)] hover:-translate-y-1 hover:border-[var(--border-strong)]">
      <div className="flex items-center justify-between gap-3">
        <span
          className="rounded-[var(--radius-pill)] border px-2.5 py-1 font-mono text-[10px] tracking-[0.12em] uppercase"
          style={{
            borderColor: categoryColor[market.category],
            color: categoryColor[market.category],
          }}
        >
          {market.category}
        </span>
        <StatusPill size="sm" status={market.status} />
      </div>

      <Link
        className="font-display min-h-[76px] text-[21px] leading-tight font-bold text-[var(--text-primary)] transition-opacity hover:opacity-75"
        href={`/markets/${market.id}`}
      >
        {market.question}
      </Link>

      <div className="flex gap-2.5">
        <OutcomeButton
          href={`/markets/${market.id}?side=yes`}
          priceCents={market.yesPriceCents}
          side="yes"
        />
        <OutcomeButton
          href={`/markets/${market.id}?side=no`}
          priceCents={market.noPriceCents}
          side="no"
        />
      </div>

      {live ? (
        <GraduationBar
          matchedUsd={market.matchedUsd}
          showCaption={false}
          targetUsd={market.graduationTargetUsd}
        />
      ) : null}

      <div className="mt-auto flex justify-between border-t border-[var(--border-soft)] pt-3 font-mono text-[11px] text-[var(--text-muted)]">
        <span>Vol {formatUsdCompact(market.volumeUsd)}</span>
        <span>b = {formatB(market.b)}</span>
      </div>
    </article>
  );
}
