"use client";

import { ShieldAlert } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { Market, MarketSide } from "@/domain/markets/types";
import { cn } from "@/lib/cn";
import { formatCents } from "@/lib/format";

const sideOptions = [
  { label: "YES", value: "yes" },
  { label: "NO", value: "no" },
];

export function ReceiptTicket({ market }: { market: Market }) {
  const [amount, setAmount] = useState("250");
  const [side, setSide] = useState<MarketSide>("yes");
  const price = side === "yes" ? market.yesPriceCents : market.noPriceCents;
  const sideColor = side === "yes" ? "var(--yes)" : "var(--no)";
  const numericAmount = Number.parseFloat(amount) || 0;
  const exposure = useMemo(
    () => (numericAmount > 0 ? numericAmount / (price / 100) : 0),
    [numericAmount, price]
  );
  const impact = Math.min((numericAmount / market.b) * 3.4, 9);

  return (
    <section className="flex flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)] p-6">
      <div className="font-mono text-[10px] tracking-[0.14em] text-[var(--text-muted)] uppercase">
        Place a receipt
      </div>
      <SegmentedControl
        accentBy={(value) => (value === "yes" ? "var(--yes)" : "var(--no)")}
        full
        onChange={(value) => setSide(value === "no" ? "no" : "yes")}
        options={sideOptions}
        value={side}
      />
      <Field
        id="receipt-amount"
        label="Amount"
        mono
        onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))}
        suffix="pUSD"
        value={amount}
      />
      <div className="grid grid-cols-4 gap-2">
        {["50", "250", "1000", "Max"].map((preset) => (
          <button
            className={cn(
              "focus-ring rounded-[var(--radius-sm)] border border-[var(--border)] px-2 py-2 font-mono text-xs text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)]",
              preset === amount ? "border-[var(--pc-cyan)] text-[var(--pc-cyan)]" : null
            )}
            key={preset}
            onClick={() => setAmount(preset === "Max" ? "5000" : preset)}
            type="button"
          >
            {preset}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-2 rounded-[var(--radius-md)] bg-[var(--surface-raised)] p-4">
        <TicketRow label="Avg price" value={formatCents(price)} />
        <TicketRow
          label="Est. receipt shares"
          tone={sideColor}
          value={`${exposure.toFixed(0)} sh`}
        />
        <TicketRow
          label="Price impact"
          tone={impact >= 5 ? "var(--status-graduating)" : undefined}
          value={`+${impact.toFixed(2)} pts`}
        />
        <TicketRow label="Slippage cap" value="1.5%" />
      </div>
      <Button
        className="w-full"
        glow={false}
        style={{
          background: sideColor,
          boxShadow: side === "yes" ? "var(--glow-lime)" : "var(--glow-magenta)",
        }}
      >
        Place {side === "yes" ? "YES" : "NO"} receipt
      </Button>
      <div className="flex gap-2.5">
        <ShieldAlert className="mt-0.5 shrink-0 text-[var(--text-muted)]" size={15} />
        <p className="text-[11.5px] leading-5 text-[var(--text-muted)]">
          Not a guaranteed fill. Clears at graduation; worst case is a full refund at
          your exact path cost.
        </p>
      </div>
    </section>
  );
}

function TicketRow({
  label,
  tone = "var(--text-primary)",
  value,
}: {
  label: string;
  tone?: string | undefined;
  value: string;
}) {
  return (
    <div className="flex justify-between gap-4 text-[13px]">
      <span className="font-mono text-[var(--text-muted)]">{label}</span>
      <span className="tabular font-mono" style={{ color: tone }}>
        {value}
      </span>
    </div>
  );
}
