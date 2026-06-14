"use client";

import { ReceiptText, WalletCards } from "lucide-react";
import Link from "next/link";

import { MetricCard } from "@/components/ui/metric-card";
import type { PlacedPregradReceipt } from "@/domain/pregrad-trading/receipt-quote";
import { useStoredReceipts } from "@/features/receipt-ticket/receipt-storage";
import { formatPercent, formatUsd, formatUsdWhole } from "@/lib/format";

export function PortfolioPage() {
  const receipts = useStoredReceipts();
  const lockedCollateral = receipts.reduce(
    (total, receipt) => total + receipt.collateralUsd,
    0
  );

  return (
    <div>
      <div className="mb-7">
        <p className="mb-2 font-mono text-[11px] tracking-[0.2em] text-[var(--accent)] uppercase">
          Portfolio
        </p>
        <h1 className="font-display text-4xl font-black tracking-normal">
          Receipts and backed positions
        </h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-6 text-[var(--text-secondary)]">
          Pre-graduation receipts stay separate from graduated YES/NO outcome tokens so
          the app never blurs intent with a final fill.
        </p>
      </div>

      <div className="mb-5 grid gap-4 md:grid-cols-3">
        <MetricCard
          icon={<ReceiptText size={20} />}
          label="Open receipts"
          tone="var(--pc-cyan)"
          value={receipts.length.toLocaleString()}
        />
        <MetricCard
          icon={<WalletCards size={20} />}
          label="Locked collateral"
          tone="var(--status-graduating)"
          value={formatUsdWhole(lockedCollateral)}
        />
        <MetricCard label="Backed positions" tone="var(--yes)" value="0" />
      </div>

      {receipts.length > 0 ? <ReceiptTable receipts={receipts} /> : <EmptyReceipts />}
    </div>
  );
}

function ReceiptTable({ receipts }: { receipts: PlacedPregradReceipt[] }) {
  return (
    <section className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)]">
      <div className="hidden grid-cols-[1.4fr_0.4fr_0.5fr_0.7fr] gap-3 border-b border-[var(--border-soft)] px-5 py-3 font-mono text-[10px] tracking-[0.12em] text-[var(--text-muted)] uppercase md:grid">
        <span>Market</span>
        <span>Side</span>
        <span>Band</span>
        <span>Status</span>
      </div>
      {receipts.map((receipt) => (
        <ReceiptRow key={receipt.id} receipt={receipt} />
      ))}
    </section>
  );
}

function ReceiptRow({ receipt }: { receipt: PlacedPregradReceipt }) {
  return (
    <div className="grid gap-3 border-b border-[var(--border-soft)] px-5 py-4 text-sm last:border-b-0 md:grid-cols-[1.4fr_0.4fr_0.5fr_0.7fr]">
      <span>
        <Link
          className="block text-[var(--text-primary)] transition-opacity hover:opacity-75"
          href={`/markets/${encodeURIComponent(receipt.marketId)}`}
        >
          {receipt.marketQuestion}
        </Link>
        <span className="font-mono text-xs text-[var(--text-muted)]">
          {formatUsd(receipt.collateralUsd)} receipt - #{receipt.receiptId}
        </span>
      </span>
      <span
        className="font-mono font-bold"
        style={{ color: receipt.side === "yes" ? "var(--yes)" : "var(--no)" }}
      >
        {receipt.side.toUpperCase()}
      </span>
      <span className="font-mono text-[var(--text-secondary)]">
        {formatPercent(receipt.priceBand.fromProbability)}-
        {formatPercent(receipt.priceBand.toProbability)}
      </span>
      <span className="text-[var(--text-secondary)]">
        Waiting for graduation
        {receipt.transactionHash ? (
          <span className="block font-mono text-[11px] text-[var(--text-muted)]">
            On-chain receipt
          </span>
        ) : (
          <span className="block font-mono text-[11px] text-[var(--text-muted)]">
            Mock receipt
          </span>
        )}
      </span>
    </div>
  );
}

function EmptyReceipts() {
  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)] p-6">
      <div className="font-mono text-[10px] tracking-[0.14em] text-[var(--text-muted)] uppercase">
        No open receipts
      </div>
      <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--text-secondary)]">
        Place a pre-graduation receipt from any bootstrap market and it will appear here
        while it waits for graduation clearing.
      </p>
    </section>
  );
}
