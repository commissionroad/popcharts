import type { Decorator, Meta, StoryObj } from "@storybook/nextjs";

import { MarketCard } from "@/components/ui/market-card";
import { MetricCard } from "@/components/ui/metric-card";
import { markets } from "@/domain/markets/fixtures";

import {
  Skeleton,
  SkeletonChart,
  SkeletonMarketCard,
  SkeletonMetricCard,
  SkeletonRegion,
  SkeletonText,
  SkeletonTableRows,
} from "./skeleton";

/**
 * Skeletons are judged against the thing they replace, so every story here is
 * framed on the real page ink at the real content width.
 */
const PageFrame: Decorator = (Story) => (
  <div style={{ background: "var(--color-page-bg)", padding: 32 }}>
    <div style={{ margin: "0 auto", maxWidth: "var(--layout-max)" }}>
      <Story />
    </div>
  </div>
);

const meta = {
  component: Skeleton,
  decorators: [PageFrame],
  parameters: { layout: "fullscreen" },
  title: "UI/Skeleton",
} satisfies Meta<typeof Skeleton>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Section label, so the composed stories read as layouts rather than as piles. */
function Caption({ children }: { children: string }) {
  return (
    <p className="mb-3 font-mono text-[10px] tracking-[0.14em] text-[var(--text-muted)] uppercase">
      {children}
    </p>
  );
}

/** A card, for stories that need to show a skeleton on the raised ground. */
function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)] p-6">
      {children}
    </div>
  );
}

/**
 * The composable set, at the sizes they are actually used. Everything else in
 * this file is these pieces arranged into a real layout.
 */
export const Primitives: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <Card>
        <Caption>Text — one line, and a paragraph</Caption>
        <div className="flex flex-col gap-5">
          <SkeletonText lineHeight={18} lines={1} />
          <SkeletonText lineHeight={12} lines={3} />
        </div>
      </Card>

      <Card>
        <Caption>Block — any rectangle, at any radius</Caption>
        <div className="flex flex-wrap items-end gap-3">
          <Skeleton height={40} radius="sm" width={40} />
          <Skeleton height={40} radius="md" width={120} />
          <Skeleton height={26} radius="pill" width={96} />
          <Skeleton height={72} radius="lg" width={72} />
        </div>
      </Card>

      <div>
        <Caption>Metric card</Caption>
        <div className="grid gap-4 md:grid-cols-3">
          <SkeletonMetricCard />
          <SkeletonMetricCard />
          <SkeletonMetricCard />
        </div>
      </div>
    </div>
  ),
};

/**
 * Why the ground knob exists. The same block on page ink and inside a card:
 * tinted for one it vanishes on the other, so each skeleton declares which
 * surface it is standing on.
 *
 * There is one theme — Pop Charts is dark-only, with no light palette in
 * `tokens.css` or in `designkit/` — so "both grounds" is what there is to
 * cover, and it is the distinction that actually breaks a skeleton.
 */
export const Grounds: Story = {
  render: () => (
    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <Caption>ground=&quot;page&quot; — directly on page ink</Caption>
        <Skeleton ground="page" height={96} radius="lg" width="100%" />
        <p className="mt-3 text-[13px] leading-5 text-[var(--text-secondary)]">
          Tints to <code className="font-mono">--surface-card</code>: it is standing in
          for a card, so it reads as one.
        </p>
      </div>
      <div>
        <Caption>ground=&quot;card&quot; — inside a card (default)</Caption>
        <Card>
          <Skeleton ground="card" height={96} radius="lg" width="100%" />
        </Card>
        <p className="mt-3 text-[13px] leading-5 text-[var(--text-secondary)]">
          Tints to <code className="font-mono">--surface-raised</code>, one step up from
          the card it sits on.
        </p>
      </div>
    </div>
  ),
};

/**
 * The discovery board mid-load. The point of the story is the pairing: a
 * skeleton card and a real card at the same width, so any height difference
 * between them — which is a page jump when the data lands — is visible here
 * instead of in production.
 */
export const DiscoveryBoardLoading: Story = {
  render: () => (
    <div>
      <Caption>Skeleton card beside the real card it replaces</Caption>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <SkeletonMarketCard />
        {markets[0] ? <MarketCard market={markets[0]} /> : null}
        <SkeletonMarketCard />
      </div>
    </div>
  ),
};

/** The whole board, as a first paint looks before any market has arrived. */
export const DiscoveryBoardFullLoad: Story = {
  render: () => (
    <SkeletonRegion label="Loading markets">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_unused, index) => (
          <SkeletonMarketCard key={index} />
        ))}
      </div>
    </SkeletonRegion>
  ),
};

/**
 * The portfolio mid-load: the summary metric row over the receipts and
 * positions tables. The table headers are real — they are known before the
 * rows are — and `SkeletonTableRows` takes the same grid template, so the
 * columns do not shift under the header when the rows land.
 */
export const PortfolioLoading: Story = {
  render: () => (
    <SkeletonRegion label="Loading your receipts, positions, and open orders">
      <div className="mb-5 grid gap-4 md:grid-cols-3">
        <SkeletonMetricCard />
        <SkeletonMetricCard />
        <SkeletonMetricCard />
      </div>

      <div className="flex flex-col gap-5">
        <TableShell
          columns="1.4fr 0.4fr 0.5fr 0.9fr"
          headers={["Market", "Side", "Avg price", "Status"]}
          title="Receipts"
        />
        <TableShell
          columns="1.4fr 0.4fr 0.5fr 0.5fr 0.5fr 0.6fr"
          headers={["Market", "Side", "Held", "Resting", "Avg", "Value"]}
          title="Backed positions"
        />
      </div>
    </SkeletonRegion>
  ),
};

/** The portfolio's real section-table chrome, with skeleton rows in the body. */
function TableShell({
  columns,
  headers,
  title,
}: {
  columns: string;
  headers: string[];
  title: string;
}) {
  return (
    <section className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)]">
      <div className="border-b border-[var(--border-soft)] px-5 py-3">
        <h2 className="font-display text-lg font-black">{title}</h2>
      </div>
      <div
        className="hidden gap-3 border-b border-[var(--border-soft)] px-5 py-3 font-mono text-[10px] tracking-[0.12em] text-[var(--text-muted)] uppercase md:grid"
        style={{ gridTemplateColumns: columns }}
      >
        {headers.map((header) => (
          <span key={header}>{header}</span>
        ))}
      </div>
      <SkeletonTableRows columns={columns} rows={3} />
    </section>
  );
}

/**
 * The market-detail price curve before its path arrives. The gridlines and
 * the axis strip are drawn for real — the chart always puts them in the same
 * place — so only the unknown part, the plotted series, shimmers.
 */
export const ChartLoading: Story = {
  render: () => (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <Caption>Price curve, loading</Caption>
        <SkeletonRegion label="Loading the price curve">
          <SkeletonChart />
        </SkeletonRegion>
      </Card>
      <Card>
        <Caption>Trade ticket sidebar, loading</Caption>
        <SkeletonRegion label="Loading the trade ticket">
          <div className="flex flex-col gap-4">
            <SkeletonText lineHeight={10} lines={1} />
            <Skeleton height={44} radius="md" width="100%" />
            <div className="flex gap-2.5">
              <Skeleton className="flex-1" height={64} radius="md" />
              <Skeleton className="flex-1" height={64} radius="md" />
            </div>
            <Skeleton height={52} radius="md" width="100%" />
          </div>
        </SkeletonRegion>
      </Card>
    </div>
  ),
};

/**
 * The reduced-motion treatment. The sweep is replaced by a flat tint rather
 * than being slowed down or frozen: the app's blanket reduced-motion rule only
 * clamps animation *duration*, which would leave every placeholder wearing a
 * bright band at whatever offset 1ms lands on.
 *
 * This story renders the ordinary skeletons — set the OS or browser to reduce
 * motion (Playwright: `reducedMotion: "reduce"`) and they go flat here.
 */
export const ReducedMotion: Story = {
  render: () => (
    <div>
      <Caption>Under prefers-reduced-motion: flat tint, no sweep</Caption>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <SkeletonMarketCard />
        <Card>
          <SkeletonText lineHeight={14} lines={4} />
        </Card>
      </div>
    </div>
  ),
};

/**
 * Metric cards paired with their loaded counterparts, at the portfolio's
 * three-up width — the second reflow check, for the summary row.
 */
export const MetricRowComparison: Story = {
  render: () => (
    <div className="grid gap-4 md:grid-cols-3">
      <SkeletonMetricCard />
      <MetricCard label="Open receipts" tone="var(--pc-cyan)" value="12" />
      <SkeletonMetricCard />
    </div>
  ),
};
