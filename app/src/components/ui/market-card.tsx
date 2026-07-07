import Link from "next/link";

import { GraduationBar } from "@/components/ui/graduation-bar";
import { OutcomeButton } from "@/components/ui/outcome-button";
import { StatusPill } from "@/components/ui/status-pill";
import {
  marketSideLabel,
  type Market,
  type MarketCategory,
} from "@/domain/markets/types";
import { formatB, formatUsdCompact } from "@/lib/format";

const categoryColor: Record<MarketCategory, string> = {
  Crypto: "var(--pc-cyan)",
  Culture: "var(--pc-amber)",
  Econ: "var(--pc-amber)",
  Politics: "var(--pc-violet)",
  Sports: "var(--pc-lime)",
  Tech: "var(--pc-cyan)",
  Weather: "var(--pc-lime)",
};

export function MarketCard({ market }: { market: Market }) {
  const live = market.status === "bootstrap" || market.status === "graduating";
  const marketHref = `/markets/${encodeURIComponent(market.id)}`;

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
        className="font-display [display:-webkit-box] min-h-[76px] overflow-hidden text-[21px] leading-tight font-bold text-[var(--text-primary)] transition-opacity [-webkit-box-orient:vertical] [-webkit-line-clamp:2] hover:opacity-75"
        href={marketHref}
      >
        {market.question}
      </Link>

      <div className="flex gap-2.5">
        <OutcomeButton
          href={`${marketHref}?side=yes`}
          label={marketSideLabel(market, "yes")}
          priceCents={market.yesPriceCents}
          side="yes"
        />
        <OutcomeButton
          href={`${marketHref}?side=no`}
          label={marketSideLabel(market, "no")}
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
