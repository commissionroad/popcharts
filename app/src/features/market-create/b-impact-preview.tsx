"use client";

import { TrendingUp } from "lucide-react";
import { useMemo } from "react";

import {
  createOpeningState,
  marginalPriceCents,
  stateAfterBudgetBuy,
} from "@/domain/lmsr/lmsr";
import { formatCents } from "@/lib/format";

const BUDGET_POINTS = [25, 50, 100, 250] as const;
const CURVE_MAX_BUDGET = 500;
const CURVE_SAMPLE_COUNT = 33;

/**
 * Advanced-section chart showing how the chosen liquidity parameter b shapes
 * early price impact: the YES price after sample receipt budgets, computed on
 * the same virtual LMSR curve the market will open with.
 */
export function BImpactPreview({
  b,
  openingProbability,
}: {
  b: number;
  openingProbability: number;
}) {
  const { curvePoints, impactPrice, openingPrice, statPoints } = useMemo(() => {
    const state = createOpeningState({ b, openingProbability });
    const priceAfterBudget = (budget: number) =>
      marginalPriceCents(
        stateAfterBudgetBuy({
          budget,
          side: "yes",
          state,
        }),
        "yes"
      );

    return {
      curvePoints: Array.from({ length: CURVE_SAMPLE_COUNT }, (_, index) => {
        const budget = (index / (CURVE_SAMPLE_COUNT - 1)) * CURVE_MAX_BUDGET;
        return {
          budget,
          price: priceAfterBudget(budget),
        };
      }),
      impactPrice: priceAfterBudget(100),
      openingPrice: marginalPriceCents(state, "yes"),
      statPoints: BUDGET_POINTS.map((budget) => ({
        budget,
        price: priceAfterBudget(budget),
      })),
    };
  }, [b, openingProbability]);

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
            Larger b is smoother and can absorb bigger early receipts, but it raises the
            graduation target. Smaller b gets there faster, but price moves more
            sharply.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-[1.1fr_0.9fr]">
        <LmsrCurve points={curvePoints} />
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
            {statPoints.map((point) => (
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
  const plot = {
    bottom: 138,
    left: 34,
    right: 306,
    top: 18,
  };
  const plotHeight = plot.bottom - plot.top;
  const plotWidth = plot.right - plot.left;
  const path = points
    .map((point, index) => {
      const x = plot.left + (point.budget / CURVE_MAX_BUDGET) * plotWidth;
      const y = priceToY(point.price, plot.bottom, plotHeight);
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--border-soft)] bg-[var(--surface-card)] p-3">
      <svg
        aria-label="LMSR YES price curve by spend"
        className="h-44 w-full overflow-visible"
        role="img"
        viewBox="0 0 320 176"
      >
        {[25, 50, 75].map((price) => {
          const y = priceToY(price, plot.bottom, plotHeight);

          return (
            <g key={price}>
              <line
                stroke="var(--border-soft)"
                strokeDasharray={price === 50 ? "0" : "4 5"}
                strokeWidth="1"
                x1={plot.left}
                x2={plot.right}
                y1={y}
                y2={y}
              />
              <text
                fill="var(--text-muted)"
                fontSize="9"
                textAnchor="end"
                x={plot.left - 8}
                y={y + 3}
              >
                {price}c
              </text>
            </g>
          );
        })}
        <line
          stroke="var(--border-soft)"
          strokeWidth="1"
          x1={plot.left}
          x2={plot.left}
          y1={plot.top}
          y2={plot.bottom}
        />
        <line
          stroke="var(--border-soft)"
          strokeWidth="1"
          x1={plot.left}
          x2={plot.right}
          y1={plot.bottom}
          y2={plot.bottom}
        />
        <path d={path} fill="none" stroke="var(--yes)" strokeWidth="3" />
        {points
          .filter((point) => point.budget === 0 || point.budget === CURVE_MAX_BUDGET)
          .map((point) => {
            const x = plot.left + (point.budget / CURVE_MAX_BUDGET) * plotWidth;
            const y = priceToY(point.price, plot.bottom, plotHeight);

            return <circle cx={x} cy={y} fill="var(--yes)" key={point.budget} r="4" />;
          })}
        <text
          fill="var(--text-muted)"
          fontSize="9"
          textAnchor="middle"
          x={plot.left}
          y="164"
        >
          $0
        </text>
        <text
          fill="var(--text-muted)"
          fontSize="9"
          textAnchor="middle"
          x={plot.right}
          y="164"
        >
          $500
        </text>
      </svg>
    </div>
  );
}

function priceToY(price: number, bottom: number, height: number) {
  return bottom - (price / 100) * height;
}
