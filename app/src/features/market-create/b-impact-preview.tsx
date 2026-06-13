"use client";

import { TrendingUp } from "lucide-react";

import {
  createOpeningState,
  marginalPriceCents,
  stateAfterBudgetBuy,
} from "@/domain/lmsr/lmsr";
import { formatCents } from "@/lib/format";

const BUDGET_POINTS = [0, 25, 50, 100, 250] as const;

export function BImpactPreview({
  b,
  openingProbability,
}: {
  b: number;
  openingProbability: number;
}) {
  const state = createOpeningState({ b, openingProbability });
  const openingPrice = marginalPriceCents(state, "yes");
  const impactPrice = marginalPriceCents(
    stateAfterBudgetBuy({ budget: 100, side: "yes", state }),
    "yes"
  );
  const points = BUDGET_POINTS.map((budget) => ({
    budget,
    price: marginalPriceCents(
      stateAfterBudgetBuy({
        budget,
        side: "yes",
        state,
      }),
      "yes"
    ),
  }));

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-raised)] p-4">
      <div className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--pc-cyan)] bg-[var(--accent-wash)] text-[var(--pc-cyan)]">
          <TrendingUp size={16} />
        </span>
        <div>
          <p className="font-mono text-[11px] font-bold tracking-[0.12em] text-[var(--text-secondary)] uppercase">
            b impact
          </p>
          <p className="mt-1 text-[12.5px] leading-5 text-[var(--text-muted)]">
            Higher b makes prices move more smoothly and raises the derived graduation
            target.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_0.9fr]">
        <LmsrCurve points={points} />
        <div className="flex flex-col justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] tracking-[0.12em] text-[var(--text-muted)] uppercase">
              $100 YES impact
            </div>
            <div className="font-display mt-1 text-[22px] font-black text-[var(--yes)]">
              {formatCents(openingPrice)} {"->"} {formatCents(impactPrice)}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {points.slice(1, 5).map((point) => (
              <div
                className="rounded-[var(--radius-sm)] border border-[var(--border-soft)] px-2.5 py-2"
                key={point.budget}
              >
                <div className="font-mono text-[10px] text-[var(--text-muted)]">
                  ${point.budget}
                </div>
                <div className="font-mono text-[13px] text-[var(--text-primary)]">
                  {formatCents(point.price)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function LmsrCurve({
  points,
}: {
  points: Array<{
    budget: number;
    price: number;
  }>;
}) {
  const minPrice = Math.min(...points.map((point) => point.price));
  const maxPrice = Math.max(...points.map((point) => point.price));
  const priceRange = Math.max(maxPrice - minPrice, 1);
  const path = points
    .map((point, index) => {
      const x = 12 + index * (176 / Math.max(points.length - 1, 1));
      const y = 88 - ((point.price - minPrice) / priceRange) * 64;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <div className="min-h-32 rounded-[var(--radius-sm)] border border-[var(--border-soft)] bg-[var(--surface-card)] p-3">
      <svg
        aria-label="YES price impact curve"
        className="h-28 w-full overflow-visible"
        role="img"
        viewBox="0 0 200 104"
      >
        <line
          stroke="var(--border-soft)"
          strokeDasharray="4 5"
          strokeWidth="1"
          x1="12"
          x2="188"
          y1="88"
          y2="88"
        />
        <path d={path} fill="none" stroke="var(--yes)" strokeWidth="3" />
        {points.map((point, index) => {
          const x = 12 + index * (176 / Math.max(points.length - 1, 1));
          const y = 88 - ((point.price - minPrice) / priceRange) * 64;

          return (
            <g key={point.budget}>
              <circle cx={x} cy={y} fill="var(--yes)" r="3.5" />
              <text
                fill="var(--text-muted)"
                fontSize="9"
                textAnchor="middle"
                x={x}
                y="101"
              >
                {point.budget === 0 ? "$0" : `$${point.budget}`}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
