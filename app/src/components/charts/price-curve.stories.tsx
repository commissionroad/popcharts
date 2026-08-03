import type { Meta, StoryObj } from "@storybook/nextjs";

import type { PostgradPricePoint, PricePathPoint } from "@/domain/markets/types";

import { PriceCurve } from "./price-curve";

/**
 * Fixture generators rather than literal arrays: the chart's whole subject is
 * the shape of a path over time, and a hand-typed list of forty timestamps is
 * unreadable and easy to get subtly out of order. Times are anchored to a
 * fixed date so stories render identically on every run.
 */
const START_MS = Date.parse("2026-06-10T09:00:00.000Z");
const MINUTE_MS = 60 * 1000;

const at = (minutesFromStart: number) =>
  new Date(START_MS + minutesFromStart * MINUTE_MS).toISOString();

/** The pre-graduation LMSR path: YES drifting up as receipts accumulate. */
const pregradCents = [
  50, 52, 51, 55, 58, 56, 60, 63, 61, 65, 68, 66, 70, 69, 72, 74, 73, 76,
];

const pregradPoints: PricePathPoint[] = pregradCents.map((cents, index) => ({
  at: at(index * 20),
  cents,
}));

/**
 * Graduation lands after the last receipt and before the first venue swap:
 * clearing, the Merkle root, finalize and pool seeding all take time, so the
 * chart has a genuine quiet stretch there.
 */
const graduatedAt = at(pregradCents.length * 20 + 25);

/**
 * The bounded venue's two pools, priced independently. The pair is kept near
 * complementary by arbitrage but deliberately never exactly 100 — the small
 * drift is what the tooltip's "Set" row reports, and a fixture that summed to
 * exactly 100 would hide the one thing this half of the chart shows.
 */
const postgradPairs: Array<[number, number]> = [
  [77, 24],
  [79, 22],
  [78, 23],
  [82, 19],
  [85, 16],
  [83, 18],
  [81, 20],
  [86, 15],
  [88, 13],
  [87, 14],
  [90, 11],
  [89, 12],
];

const postgradPoints: PostgradPricePoint[] = postgradPairs.map(
  ([yesCents, noCents], index) => ({
    at: at(pregradCents.length * 20 + 40 + index * 15),
    noCents,
    yesCents,
  })
);

const meta = {
  args: {
    points: pregradPoints,
  },
  component: PriceCurve,
  render: (args) => (
    <main className="min-h-screen bg-[var(--color-page-bg)] p-4 sm:p-8">
      <div className="mx-auto w-full max-w-2xl">
        <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)] p-5">
          <div className="mb-2 font-mono text-[10px] tracking-[0.14em] text-[var(--text-muted)] uppercase">
            Price history
          </div>
          <PriceCurve {...args} />
        </div>
      </div>
    </main>
  ),
  title: "Charts/Price Curve",
} satisfies Meta<typeof PriceCurve>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A market still on the receipt book: no rule, no shaded region. */
export const Pregrad: Story = {};

/** The full life of a market — LMSR, the graduation rule, then venue trading. */
export const GraduatedWithVenueTrading: Story = {
  args: {
    graduatedAt,
    postgradPoints,
  },
};

/**
 * Graduated, but no venue swap has landed yet. Receipts stop at graduation, so
 * the time axis ends before the graduation moment and there is nowhere on it
 * to draw the rule — the chart honestly shows the receipt history alone, and
 * the page's status pill carries the "graduated" news instead. Extending the
 * axis past its last sample to make room for the rule is an open design
 * question, not something this chart does today.
 */
export const GraduatedNoVenueTradesYet: Story = {
  args: {
    graduatedAt,
  },
};

/** Creator-applied outcome labels replace YES/NO in the legend and tooltip. */
export const CustomOutcomeLabels: Story = {
  args: {
    graduatedAt,
    noLabel: "Egypt",
    postgradPoints,
    yesLabel: "Argentina",
  },
};

/**
 * A wide complete-set gap: both pools rich at once, so YES + NO runs well over
 * 100% and the arbitrage is on offer. Exercises the readout the shared-LMSR
 * half of the chart can never produce.
 */
export const WideCompleteSetGap: Story = {
  args: {
    graduatedAt,
    postgradPoints: postgradPoints.map((point, index) => ({
      ...point,
      noCents: point.noCents + (index > 5 ? 14 : 2),
    })),
  },
};

/**
 * A fixture-backed sample market: prices with no timestamps at all. The path
 * falls back to even index spacing, and the time axis, range pills and
 * graduation rule all drop out because none of them can be placed.
 */
export const UntimedFixturePath: Story = {
  args: {
    graduatedAt,
    points: pregradCents.map((cents) => ({ cents })),
  },
};
