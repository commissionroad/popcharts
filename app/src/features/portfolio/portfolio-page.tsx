import { ReceiptText, WalletCards } from "lucide-react";

import { MetricCard } from "@/components/ui/metric-card";

const receiptRows = [
  {
    band: "28-64%",
    market: "Will ETH flip $5,000 before August?",
    side: "YES",
    status: "Waiting for graduation",
    value: "$250",
  },
  {
    band: "49-41%",
    market: "Will the Fed cut rates at the next meeting?",
    side: "NO",
    status: "Refund-ready if unmatched",
    value: "$100",
  },
];

export function PortfolioPage() {
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
          value="2"
        />
        <MetricCard
          icon={<WalletCards size={20} />}
          label="Locked collateral"
          tone="var(--status-graduating)"
          value="$350"
        />
        <MetricCard label="Backed positions" tone="var(--yes)" value="0" />
      </div>

      <section className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)]">
        <div className="grid grid-cols-[1.4fr_0.4fr_0.5fr_0.7fr] gap-3 border-b border-[var(--border-soft)] px-5 py-3 font-mono text-[10px] tracking-[0.12em] text-[var(--text-muted)] uppercase">
          <span>Market</span>
          <span>Side</span>
          <span>Band</span>
          <span>Status</span>
        </div>
        {receiptRows.map((row) => (
          <div
            className="grid grid-cols-[1.4fr_0.4fr_0.5fr_0.7fr] gap-3 border-b border-[var(--border-soft)] px-5 py-4 text-sm last:border-b-0"
            key={row.market}
          >
            <span>
              <span className="block text-[var(--text-primary)]">{row.market}</span>
              <span className="font-mono text-xs text-[var(--text-muted)]">
                {row.value} receipt
              </span>
            </span>
            <span
              className="font-mono font-bold"
              style={{ color: row.side === "YES" ? "var(--yes)" : "var(--no)" }}
            >
              {row.side}
            </span>
            <span className="font-mono text-[var(--text-secondary)]">{row.band}</span>
            <span className="text-[var(--text-secondary)]">{row.status}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
