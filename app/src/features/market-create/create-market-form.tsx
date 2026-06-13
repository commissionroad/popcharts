"use client";

import { Info, Rocket, SlidersHorizontal } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { StatusPill } from "@/components/ui/status-pill";
import { MARKET_CATEGORIES, type MarketCategory } from "@/domain/markets/types";
import { cn } from "@/lib/cn";
import { formatB, formatCents } from "@/lib/format";

export function CreateMarketForm() {
  const [advanced, setAdvanced] = useState(false);
  const [b, setB] = useState(5_000);
  const [category, setCategory] = useState<MarketCategory>("Crypto");
  const [question, setQuestion] = useState("Will ETH flip $5,000 before August?");
  const [yesProbability, setYesProbability] = useState(50);
  const noProbability = 100 - yesProbability;

  return (
    <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
      <section className="flex flex-col gap-5 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)] p-6 sm:p-7">
        <Field
          hint="Phrase it so it resolves to a clear YES or NO."
          id="question"
          label="Market question"
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Will X happen by Y?"
          value={question}
        />

        <div>
          <span className="font-mono text-[11px] font-bold tracking-[0.12em] text-[var(--text-secondary)] uppercase">
            Category
          </span>
          <div className="mt-2 flex flex-wrap gap-2">
            {MARKET_CATEGORIES.map((item) => (
              <button
                className={cn(
                  "focus-ring rounded-[var(--radius-pill)] border px-3.5 py-2 font-mono text-xs transition-colors",
                  category === item
                    ? "border-[var(--accent)] bg-[var(--accent-wash)] text-[var(--accent)]"
                    : "border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]"
                )}
                key={item}
                onClick={() => setCategory(item)}
                type="button"
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        <Field
          id="description"
          label="Description"
          multiline
          placeholder="Context, sources, and exactly how this resolves."
        />

        <div>
          <div className="mb-3 flex items-baseline justify-between">
            <span className="font-mono text-[11px] font-bold tracking-[0.12em] text-[var(--text-secondary)] uppercase">
              Opening probability
            </span>
            <span className="font-mono text-[13px] text-[var(--text-muted)]">
              P0 = {yesProbability}%
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-display w-14 text-[22px] font-black text-[var(--yes)]">
              {yesProbability}%
            </span>
            <input
              aria-label="Opening YES probability"
              className="flex-1 accent-[var(--accent)]"
              max="98"
              min="2"
              onChange={(event) => setYesProbability(Number(event.target.value))}
              type="range"
              value={yesProbability}
            />
            <span className="font-display w-14 text-right text-[22px] font-black text-[var(--no)]">
              {noProbability}%
            </span>
          </div>
          <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">
            Markets do not need to open at 50/50. The prior is a coordinate, not
            collateral.
          </p>
        </div>

        <div className="border-t border-[var(--border-soft)] pt-5">
          <button
            className="focus-ring flex items-center gap-2 text-[var(--text-secondary)]"
            onClick={() => setAdvanced((current) => !current)}
            type="button"
          >
            <SlidersHorizontal size={15} color="var(--pc-cyan)" />
            <span className="font-mono text-xs font-bold tracking-[0.1em] uppercase">
              Advanced
            </span>
          </button>
          {advanced ? (
            <div className="mt-5 flex flex-col gap-5">
              <div>
                <div className="mb-3 flex items-baseline justify-between">
                  <span className="font-mono text-[11px] font-bold tracking-[0.12em] text-[var(--text-secondary)] uppercase">
                    Liquidity parameter b
                  </span>
                  <span className="font-mono text-[15px] text-[var(--pc-cyan)]">
                    {formatB(b)}
                  </span>
                </div>
                <input
                  aria-label="Virtual LMSR liquidity parameter b"
                  className="w-full accent-[var(--pc-cyan)]"
                  max="10000"
                  min="500"
                  onChange={(event) => setB(Number(event.target.value))}
                  step="500"
                  type="range"
                  value={b}
                />
                <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">
                  Virtual smoothness, not a bankroll. Higher b moves the price more
                  gently per receipt.
                </p>
              </div>
              <Field
                id="collateral-token"
                label="Collateral token"
                mono
                readOnly
                value="pUSD"
              />
              <Field
                hint="At close, unmatched receipts refund automatically."
                id="trading-close"
                label="Trading close"
                mono
                readOnly
                value="2026-08-01 00:00 UTC"
              />
            </div>
          ) : null}
        </div>
      </section>

      <aside className="flex flex-col gap-4 lg:sticky lg:top-24">
        <div className="flex flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)] p-6">
          <div className="font-mono text-[10px] tracking-[0.14em] text-[var(--text-muted)] uppercase">
            Live preview
          </div>
          <div className="flex items-center justify-between">
            <span className="rounded-[var(--radius-pill)] border border-[var(--pc-cyan)] px-2.5 py-1 font-mono text-[10px] tracking-[0.12em] text-[var(--pc-cyan)] uppercase">
              {category}
            </span>
            <StatusPill size="sm" status="bootstrap" />
          </div>
          <div className="font-display min-h-12 text-xl leading-tight font-bold">
            {question || "Your question appears here"}
          </div>
          <div className="flex gap-2.5">
            <PreviewOutcome label="YES" price={yesProbability} side="yes" />
            <PreviewOutcome label="NO" price={noProbability} side="no" />
          </div>
          <div className="flex justify-between border-t border-[var(--border-soft)] pt-3 font-mono text-[11px] text-[var(--text-muted)]">
            <span>Vol $0</span>
            <span>b = {formatB(b)}</span>
          </div>
        </div>
        <div className="flex gap-3 rounded-[var(--radius-md)] border border-[var(--no-border)] bg-[var(--accent-wash)] p-4">
          <Info className="mt-0.5 shrink-0 text-[var(--accent)]" size={16} />
          <p className="text-[12.5px] leading-5 text-[var(--text-secondary)]">
            Bets are receipts, not fills. They clear at graduation; unmatched amounts
            refund at exact path cost.
          </p>
        </div>
        <Button leftIcon={<Rocket size={18} />} size="lg">
          Pop a market
        </Button>
        <span className="text-center font-mono text-[11px] text-[var(--text-muted)]">
          No seed capital required
        </span>
      </aside>
    </div>
  );
}

function PreviewOutcome({
  label,
  price,
  side,
}: {
  label: string;
  price: number;
  side: "yes" | "no";
}) {
  const color = side === "yes" ? "var(--yes)" : "var(--no)";
  const border = side === "yes" ? "var(--yes-border)" : "var(--no-border)";

  return (
    <div
      className="flex-1 rounded-[var(--radius-md)] border bg-[var(--surface-raised)] p-3.5"
      style={{ borderColor: border }}
    >
      <div className="font-mono text-[11px] font-bold" style={{ color }}>
        {label}
      </div>
      <div className="font-display mt-1 text-[22px] font-black" style={{ color }}>
        {formatCents(price)}
      </div>
    </div>
  );
}
