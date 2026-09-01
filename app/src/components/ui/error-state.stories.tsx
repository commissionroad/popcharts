import type { Decorator, Meta, StoryObj } from "@storybook/nextjs";

import { MetricCard } from "@/components/ui/metric-card";
import { getErrorMessage } from "@/lib/error-handling";

import {
  EmptyState,
  ErrorState,
  OfflineState,
  PageErrorState,
  PermissionDeniedState,
  SectionErrorState,
  WalletRequiredState,
} from "./error-state";

const PageFrame: Decorator = (Story) => (
  <div style={{ background: "var(--color-page-bg)", padding: 32 }}>
    <div style={{ margin: "0 auto", maxWidth: "var(--layout-max)" }}>
      <Story />
    </div>
  </div>
);

const meta = {
  // Meta-level args so the composed stories below — which render whole layouts
  // rather than one component — inherit a valid arg set and only override what
  // they mean to.
  args: {
    body: "The venue indexer didn't answer this read. Nothing has been lost; retrying re-reads just this section.",
    title: "Backed positions unavailable",
  },
  component: ErrorState,
  decorators: [PageFrame],
  parameters: { layout: "fullscreen" },
  title: "UI/Error state",
} satisfies Meta<typeof ErrorState>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The base component, driven by the controls panel. */
export const Base: Story = {
  args: {
    action: { label: "Retry" },
    tone: "danger",
    variant: "section",
  },
};

function Caption({ children }: { children: string }) {
  return (
    <p className="mb-3 font-mono text-[10px] tracking-[0.14em] text-[var(--text-muted)] uppercase">
      {children}
    </p>
  );
}

/** The portfolio page header, so the section stories sit in a real page. */
function PageHeader() {
  return (
    <div className="mb-7">
      <p className="mb-2 font-mono text-[11px] tracking-[0.2em] text-[var(--accent)] uppercase">
        Portfolio
      </p>
      <h1 className="font-display text-4xl font-black tracking-normal">
        Receipts and backed positions
      </h1>
    </div>
  );
}

/**
 * The whole surface is gone. Nothing else on the page rendered, so the state
 * takes the content column and offers the one action that can change the
 * outcome.
 */
export const WholePageFailure: Story = {
  render: () => (
    <div>
      <PageHeader />
      <PageErrorState
        body="The indexer answered, but not with a portfolio this app can read. Retrying is worth one attempt; if it fails again the indexer is behind and the digest below identifies this response."
        detail="digest 8f2c14ab9e"
        onRetry={() => undefined}
        title="Portfolio didn't load"
      />
    </div>
  ),
};

/**
 * The case the ADR item is really about: one section failed and the rest of
 * the page is fine. The metric row and the receipts table are still live and
 * still usable — only positions is missing, and it says so in its own slot
 * rather than replacing the page.
 */
export const SectionFailedPageFine: Story = {
  render: () => (
    <div>
      <PageHeader />
      <div className="mb-5 grid gap-4 md:grid-cols-3">
        <MetricCard label="Open receipts" tone="var(--pc-cyan)" value="12" />
        <MetricCard
          label="Locked collateral"
          tone="var(--status-graduating)"
          value="$1,480"
        />
        <MetricCard label="Backed positions" tone="var(--yes)" value="—" />
      </div>

      <div className="flex flex-col gap-5">
        <LoadedSection title="Receipts" />
        <SectionErrorState
          body="Receipts above are current. Backed positions come from the venue indexer, which didn't answer this read — nothing has been lost, and retrying re-reads just this section."
          onRetry={() => undefined}
          title="Backed positions unavailable"
        />
      </div>
    </div>
  ),
};

/** A section that loaded, for contrast beside the one that didn't. */
function LoadedSection({ title }: { title: string }) {
  return (
    <section className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)]">
      <div className="border-b border-[var(--border-soft)] px-5 py-3">
        <h2 className="font-display text-lg font-black">{title}</h2>
      </div>
      <div className="grid grid-cols-[1.4fr_0.4fr_0.5fr_0.9fr] gap-3 border-b border-[var(--border-soft)] px-5 py-3 font-mono text-[10px] tracking-[0.12em] text-[var(--text-muted)] uppercase">
        <span>Market</span>
        <span>Side</span>
        <span>Avg price</span>
        <span>Status</span>
      </div>
      {["ETH above $5,000 by July 31", "Fed cuts rates in September"].map((market) => (
        <div
          className="grid grid-cols-[1.4fr_0.4fr_0.5fr_0.9fr] gap-3 border-b border-[var(--border-soft)] px-5 py-4 text-sm last:border-b-0"
          key={market}
        >
          <span className="text-[var(--text-primary)]">{market}</span>
          <span className="font-mono font-bold text-[var(--yes)]">YES</span>
          <span className="font-mono text-[var(--text-secondary)]">62¢</span>
          <span className="font-mono text-[var(--text-secondary)]">Matched</span>
        </div>
      ))}
    </section>
  );
}

/**
 * An empty result is not a failure, and this is the pairing that proves the
 * two are told apart. Same slot, same width, deliberately different weight:
 * muted and dashed for "there is nothing here yet", tone and solid for "this
 * did not load". Confusing the two either alarms a new user or hides a real
 * outage.
 */
export const EmptyVersusFailed: Story = {
  render: () => (
    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <Caption>Empty — the read worked, there is nothing yet</Caption>
        <EmptyState
          action={{ href: "/", label: "Browse markets" }}
          body="Place a pre-graduation receipt from any bootstrap market and it appears here while it waits for graduation clearing."
          title="No receipts yet"
        />
      </div>
      <div>
        <Caption>Failed — the read did not work</Caption>
        <SectionErrorState
          body="The receipts read timed out. Any receipt you placed is still on chain; this page just couldn't list them."
          onRetry={() => undefined}
          title="Receipts unavailable"
        />
      </div>
    </div>
  ),
};

/**
 * Offline or unreachable API. Separated from a server error because the fix
 * is the user's, and because a failed read on a portfolio page reads as a lost
 * position unless the copy says otherwise — so it does.
 */
export const OfflineOrUnreachable: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <div>
        <Caption>Section variant — one card couldn&apos;t read</Caption>
        <OfflineState onRetry={() => undefined} />
      </div>
      <div>
        <Caption>Page variant — nothing could read</Caption>
        <OfflineState onRetry={() => undefined} title="You're offline" variant="page" />
      </div>
      <div>
        <Caption>Inline variant — content on screen is stale, not gone</Caption>
        <OfflineState
          body="Showing the last indexed book. Live updates reconnect on their own."
          title="Live updates interrupted"
          variant="inline"
        />
      </div>
    </div>
  ),
};

/**
 * Wallet not connected. An invitation rather than a failure — the user has
 * done nothing wrong — so it takes the info tone and leads with the action.
 */
export const WalletNotConnected: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <div>
        <Caption>Section variant</Caption>
        <WalletRequiredState onConnect={() => undefined} />
      </div>
      <div>
        <Caption>Page variant — the whole surface needs a wallet</Caption>
        <WalletRequiredState
          body="Your studio holds your drafts, templates, and live markets. Connect the wallet that created them to open it."
          onConnect={() => undefined}
          title="Connect to open your studio"
          variant="page"
        />
      </div>
    </div>
  ),
};

/**
 * Connected, and still refused. The address is shown because "not allowed"
 * plus a silent account switch is the shape of this bug report — showing which
 * wallet was refused answers it before it is filed.
 */
export const PermissionDenied: Story = {
  render: () => (
    <PermissionDeniedState
      action={{ label: "Switch wallet", onClick: () => undefined }}
      body="This draft belongs to another wallet. Drafts are private to the wallet that created them, so connect that one to open it."
      walletAddress="0x8f2c…14ab"
    />
  ),
};

/**
 * The seam with `presentError` (`@/lib/error-handling`). Copy shown to the
 * user comes from that helper, not from the raw thrown message — it decides which
 * errors are safe to show verbatim and collapses everything else to a fallback
 * the surface chose. These three bodies are the helper's real output for three
 * real throws.
 *
 * The stories call `getErrorMessage`, `presentError`'s pure sibling, purely so
 * a story render does not also write to the error log; at a live call site the
 * logging one is what belongs in the `catch`.
 */
export const CopyFromPresentError: Story = {
  render: () => {
    const fallback = "Backed positions didn't load.";

    return (
      <div className="flex flex-col gap-6">
        <div>
          <Caption>Transport failure → the shared network copy</Caption>
          <OfflineState
            body={getErrorMessage(new Error("fetch failed"), { fallback })}
            onRetry={() => undefined}
          />
        </div>
        <div>
          <Caption>Wallet rejection → the shared wallet copy</Caption>
          <ErrorState
            action={{ label: "Try again", onClick: () => undefined }}
            body={getErrorMessage(new Error("User rejected the request"), {
              fallback: "The order wasn't placed.",
            })}
            title="Order not placed"
            tone="warning"
            variant="inline"
          />
        </div>
        <div>
          <Caption>
            Unrecognized error → the surface&apos;s fallback, never the raw text
          </Caption>
          <SectionErrorState
            body={getErrorMessage(new Error("ECONNRESET at pool.ts:44"), {
              fallback,
            })}
            onRetry={() => undefined}
            title="Backed positions unavailable"
          />
        </div>
      </div>
    );
  },
};

/**
 * The base component's tones and variants in one place, for picking one. Reach
 * for a named state above first — these are the knobs behind them, and five
 * failures rendering as the same box with different words is the thing this
 * set exists to stop.
 */
export const TonesAndVariants: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <div>
        <Caption>Inline — degrades content that is still on screen</Caption>
        <div className="flex flex-col gap-3">
          <ErrorState
            body="Two of eleven positions failed to price. The rest are current."
            title="Partial read"
            tone="warning"
            variant="inline"
          />
          <ErrorState
            action={{ label: "Reconnect", onClick: () => undefined }}
            body="The live channel dropped. Figures stop updating until it reconnects."
            title="Live feed offline"
            tone="info"
            variant="inline"
          />
        </div>
      </div>
      <div>
        <Caption>Section — the slot its content would have filled</Caption>
        <div className="grid gap-4 md:grid-cols-2">
          <ErrorState
            action={{ label: "Retry", onClick: () => undefined }}
            body="The order book read failed. Resting orders are unaffected."
            title="Order book unavailable"
            tone="danger"
          />
          <ErrorState
            body="Clearing results appear once the keeper publishes them."
            title="Not cleared yet"
            tone="muted"
          />
        </div>
      </div>
    </div>
  ),
};
