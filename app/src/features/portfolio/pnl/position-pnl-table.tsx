import type { ReactNode } from "react";

import {
  portfolioPnl,
  positionPnl,
  type PositionPnlInput,
} from "@/domain/portfolio/pnl";
import { wadPriceToCents } from "@/domain/postgrad-trading/limit-order";
import { wadToNumber } from "@/domain/tokens/wad";
import { cn } from "@/lib/cn";
import { formatCents, formatTokenAmount, formatUsd } from "@/lib/format";

import { PnlValue } from "./pnl-value";

/**
 * How a position stands: still trading, or settled by resolution. A settled
 * position's mark price is a fact rather than a quote (winner 1, loser 0, draw
 * ½), so the row labels it as an outcome instead of a price.
 */
export type PositionStanding = "lost" | "open" | "void" | "won";

const STANDING: Record<
  Exclude<PositionStanding, "open">,
  { label: string; tone: string }
> = {
  lost: { label: "Lost", tone: "var(--negative)" },
  void: { label: "Void", tone: "var(--text-muted)" },
  won: { label: "Won", tone: "var(--positive)" },
};

/**
 * One row of the P&L table. The cost figures are the ones `/portfolio` does
 * not return yet (see this feature's stories and the PR that introduced them);
 * everything else already exists on `PortfolioPosition`.
 */
export type PnlPositionRow = PositionPnlInput & {
  /** How many fills built the open lot, shown where an average hides spread. */
  entryFillCount?: number;
  /** Stable list key — a position is unique on market plus side. */
  id: string;
  marketId: string;
  marketQuestion?: string;
  side: "no" | "yes";
  standing?: PositionStanding;
};

/**
 * Profit and loss across a wallet's graduated positions: what each lot cost,
 * what it is worth now, and the realised/unrealised split — with a rollup
 * across every position in the section header.
 *
 * Presentational only. It takes every number as a prop so the surface can be
 * designed and reviewed before the server read model that would feed it
 * exists (`docs/portfolio-data-design.md`, rollout phase 6).
 */
export function PositionPnlTable({
  error = null,
  loading = false,
  rows,
}: {
  error?: string | null;
  loading?: boolean;
  rows: PnlPositionRow[];
}) {
  if (error) {
    return (
      <Section>
        <SectionHeader title="Position P&L" />
        <div className="px-5 py-6">
          <div className="font-mono text-[10px] tracking-[0.14em] text-[var(--negative)] uppercase">
            P&L unavailable
          </div>
          <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--text-secondary)]">
            {error}
          </p>
        </div>
      </Section>
    );
  }

  if (loading) {
    return <PnlTableSkeleton />;
  }

  if (rows.length === 0) {
    return (
      <Section>
        <SectionHeader title="Position P&L" />
        <div className="px-5 py-6">
          <div className="font-mono text-[10px] tracking-[0.14em] text-[var(--text-muted)] uppercase">
            Nothing to price yet
          </div>
          <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--text-secondary)]">
            Profit and loss appears once you hold YES/NO tokens in a graduated market.
            Receipts awaiting graduation have no P&L — their cost is still locked
            collateral.
          </p>
        </div>
      </Section>
    );
  }

  const summary = portfolioPnl(rows);

  return (
    <Section>
      <SectionHeader
        title="Position P&L"
        trailing={
          <div className="text-right">
            <div className="font-mono text-[10px] tracking-[0.12em] text-[var(--text-muted)] uppercase">
              Total P&L
            </div>
            <PnlValue
              amountWad={summary.totalWad}
              returnBps={summary.returnBps}
              size="lg"
            />
          </div>
        }
      />

      <div className="hidden gap-3 border-b border-[var(--border-soft)] px-5 py-3 font-mono text-[10px] tracking-[0.12em] text-[var(--text-muted)] uppercase md:grid md:grid-cols-[1.5fr_0.4fr_0.6fr_0.6fr_0.5fr_0.7fr_0.8fr_1fr]">
        <span>Market</span>
        <span>Side</span>
        <span>Owned</span>
        <span>Avg entry</span>
        <span>Mark</span>
        <span>Value</span>
        <span>Realised</span>
        <span>Unrealised</span>
      </div>

      {rows.map((row) => (
        <PnlRow key={row.id} row={row} />
      ))}

      <SummaryRow positionCount={rows.length} summary={summary} />
    </Section>
  );
}

function PnlRow({ row }: { row: PnlPositionRow }) {
  const pnl = positionPnl(row);
  const standing = row.standing ?? "open";

  return (
    <div className="grid gap-3 border-b border-[var(--border-soft)] px-5 py-4 text-sm last:border-b-0 md:grid-cols-[1.5fr_0.4fr_0.6fr_0.6fr_0.5fr_0.7fr_0.8fr_1fr]">
      <span className="flex flex-col gap-1">
        <span className="text-[var(--text-primary)]">
          {row.marketQuestion ?? `Market #${row.marketId}`}
        </span>
        <span className="flex items-center gap-2">
          {standing === "open" ? null : (
            <span
              className="rounded-[var(--radius-pill)] border px-2 py-0.5 font-mono text-[10px] tracking-[0.1em] uppercase"
              style={{
                borderColor: STANDING[standing].tone,
                color: STANDING[standing].tone,
              }}
            >
              {STANDING[standing].label}
            </span>
          )}
          {row.entryFillCount === undefined ? null : (
            <span className="font-mono text-[11px] text-[var(--text-muted)]">
              {row.entryFillCount} fills
            </span>
          )}
          <span className="font-mono text-[11px] text-[var(--text-muted)]">
            cost {formatUsd(wadToNumber(row.costBasisWad))}
          </span>
        </span>
      </span>

      <Cell label="Side">
        <span
          className="font-mono font-bold"
          style={{ color: row.side === "yes" ? "var(--yes)" : "var(--no)" }}
        >
          {row.side.toUpperCase()}
        </span>
      </Cell>

      <Cell label="Owned">
        <span className="tabular font-mono text-[var(--text-secondary)]">
          {formatTokenAmount(row.ownedTotalWad)}
        </span>
      </Cell>

      <Cell label="Avg entry">
        <span className="tabular font-mono text-[var(--text-secondary)]">
          {pnl.avgEntryPriceWad === null
            ? "-"
            : formatCents(wadPriceToCents(pnl.avgEntryPriceWad))}
        </span>
      </Cell>

      <Cell label="Mark">
        <span className="tabular font-mono text-[var(--text-secondary)]">
          {row.markPriceWad === null
            ? "-"
            : formatCents(wadPriceToCents(row.markPriceWad))}
        </span>
      </Cell>

      <Cell label="Value">
        <span className="tabular font-mono font-bold text-[var(--text-primary)]">
          {pnl.marketValueWad === null
            ? "-"
            : formatUsd(wadToNumber(pnl.marketValueWad))}
        </span>
      </Cell>

      <Cell label="Realised">
        <PnlValue amountWad={pnl.realisedWad} />
      </Cell>

      <Cell label="Unrealised">
        <PnlValue amountWad={pnl.unrealisedWad} returnBps={pnl.unrealisedReturnBps} />
      </Cell>
    </div>
  );
}

/**
 * The rollup, on the same grid as the rows so each subtotal sits under the
 * column it sums. An unpriced position contributes its cost and its realised
 * P&L but no paper gain, so the row says so rather than presenting a partial
 * total as final.
 */
function SummaryRow({
  positionCount,
  summary,
}: {
  positionCount: number;
  summary: ReturnType<typeof portfolioPnl>;
}) {
  return (
    <div className="grid gap-3 border-t border-[var(--border)] px-5 py-4 text-sm md:grid-cols-[1.5fr_0.4fr_0.6fr_0.6fr_0.5fr_0.7fr_0.8fr_1fr]">
      <span className="flex flex-col gap-1">
        <span className="font-display font-black text-[var(--text-primary)]">
          All positions
        </span>
        <span className="font-mono text-[11px] text-[var(--text-muted)]">
          {positionCount} {positionCount === 1 ? "position" : "positions"} - cost{" "}
          {formatUsd(wadToNumber(summary.costBasisWad))}
          {summary.unpricedCount > 0 ? ` - ${summary.unpricedCount} unpriced` : ""}
        </span>
      </span>
      <span className="hidden md:block" />
      <span className="hidden md:block" />
      <span className="hidden md:block" />
      <span className="hidden md:block" />
      <Cell label="Value">
        <span className="tabular font-mono font-bold text-[var(--text-primary)]">
          {formatUsd(wadToNumber(summary.marketValueWad))}
        </span>
      </Cell>
      <Cell label="Realised">
        <PnlValue amountWad={summary.realisedWad} />
      </Cell>
      <Cell label="Unrealised">
        <PnlValue amountWad={summary.unrealisedWad} />
      </Cell>
    </div>
  );
}

/**
 * A cell with its column name repeated below the `md` breakpoint, where the
 * header row is hidden and a bare number would be unreadable.
 */
function Cell({ children, label }: { children: ReactNode; label: string }) {
  return (
    <span className="flex items-baseline justify-between gap-3 md:block">
      <span className="font-mono text-[10px] tracking-[0.12em] text-[var(--text-muted)] uppercase md:hidden">
        {label}
      </span>
      {children}
    </span>
  );
}

/**
 * Placeholder rows while the read is in flight. Deliberately local: the shared
 * skeleton primitive is a separate open ADR 0013 item, and this section should
 * adopt it rather than the other way round.
 */
function PnlTableSkeleton() {
  return (
    <Section>
      <SectionHeader title="Position P&L" trailing={<Shimmer className="h-8 w-32" />} />
      <div aria-busy="true" aria-label="Loading position P&L">
        {[0, 1, 2].map((index) => (
          <div
            className="grid gap-3 border-b border-[var(--border-soft)] px-5 py-4 last:border-b-0 md:grid-cols-[1.5fr_0.4fr_0.6fr_0.6fr_0.5fr_0.7fr_0.8fr_1fr]"
            key={index}
          >
            <Shimmer className="h-4 w-3/4" />
            <Shimmer className="h-4 w-10" />
            <Shimmer className="h-4 w-14" />
            <Shimmer className="h-4 w-12" />
            <Shimmer className="h-4 w-10" />
            <Shimmer className="h-4 w-16" />
            <Shimmer className="h-4 w-16" />
            <Shimmer className="h-4 w-20" />
          </div>
        ))}
      </div>
    </Section>
  );
}

function Shimmer({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "block animate-pulse rounded-[var(--radius-pill)] bg-[var(--border-soft)]",
        className
      )}
    />
  );
}

function Section({ children }: { children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)]">
      {children}
    </section>
  );
}

function SectionHeader({ title, trailing }: { title: string; trailing?: ReactNode }) {
  return (
    // Wraps rather than squeezes: on a narrow viewport the rollup drops onto
    // its own line instead of crushing the title to two words.
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-[var(--border-soft)] px-5 py-3">
      <h2 className="font-display text-lg font-black">{title}</h2>
      {trailing ? <div className="ml-auto">{trailing}</div> : null}
    </div>
  );
}
