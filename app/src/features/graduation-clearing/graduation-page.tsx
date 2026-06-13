import { ArrowLeft, CheckCircle2, Coins, ReceiptText, RotateCcw } from "lucide-react";
import Link from "next/link";

import { BandStrip } from "@/components/charts/band-strip";
import { Button } from "@/components/ui/button";
import { GraduationBar } from "@/components/ui/graduation-bar";
import { MetricCard } from "@/components/ui/metric-card";
import { StatusPill } from "@/components/ui/status-pill";
import type { Market } from "@/domain/markets/types";
import { formatUsdCompact } from "@/lib/format";

export function GraduationPage({ market }: { market: Market }) {
  const refundedUsd = Math.max(market.volumeUsd - market.matchedUsd, 0);

  return (
    <div>
      <Link
        className="mb-6 inline-flex items-center gap-2 font-mono text-[13px] text-[var(--text-secondary)] transition-opacity hover:opacity-70"
        href={`/markets/${market.id}`}
      >
        <ArrowLeft size={15} /> Back to market
      </Link>

      <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 font-mono text-[11px] tracking-[0.2em] text-[var(--status-graduating)] uppercase">
            Band-pass clearing
          </p>
          <h1 className="font-display max-w-3xl text-3xl leading-tight font-black sm:text-4xl">
            {market.question}
          </h1>
        </div>
        <StatusPill status="graduating" />
      </div>

      <div className="mb-5 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)] p-6">
        <GraduationBar
          height={10}
          matchedUsd={market.matchedUsd}
          targetUsd={market.graduationTargetUsd}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.3fr_0.7fr]">
        <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)] p-6">
          <div className="mb-2 font-mono text-[10px] tracking-[0.14em] text-[var(--text-muted)] uppercase">
            Price-band overlap - which bands both sides crossed
          </div>
          <p className="mb-5 max-w-2xl text-[13px] leading-6 text-[var(--text-secondary)]">
            Clearing passes exactly the bands crossed by YES and NO demand in opposite
            directions. Matched bands mint fully collateralized complete sets;
            everything else refunds at its exact path cost.
          </p>
          <BandStrip />
        </section>

        <aside className="flex flex-col gap-3.5">
          <MetricCard
            icon={<CheckCircle2 size={20} />}
            label="Matched market cap"
            tone="var(--status-graduated)"
            value={formatUsdCompact(market.matchedUsd)}
          />
          <MetricCard
            icon={<Coins size={20} />}
            label="Complete sets minted"
            value={Math.round(market.matchedUsd).toLocaleString()}
          />
          <MetricCard
            icon={<RotateCcw size={20} />}
            label="Refunded unmatched"
            tone="var(--accent)"
            value={formatUsdCompact(refundedUsd)}
          />
          <MetricCard
            icon={<ReceiptText size={20} />}
            label="Receipts cleared"
            value={market.receiptCount.toLocaleString()}
          />
          <Button className="w-full" leftIcon={<Coins size={18} />} size="lg">
            Graduate market
          </Button>
          <span className="text-center font-mono text-[11px] leading-5 text-[var(--text-muted)]">
            Locked collateral equals max payout. No bad debt.
          </span>
        </aside>
      </div>
    </div>
  );
}
