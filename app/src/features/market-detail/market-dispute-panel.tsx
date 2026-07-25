"use client";

import { Gavel, Loader2, ShieldAlert } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { formatUnits } from "viem";

import { type Market, marketSideLabel } from "@/domain/markets/types";
import { useDispute } from "@/integrations/contracts/hooks/use-dispute";
import { useMarketDisputeState } from "@/integrations/contracts/hooks/use-market-dispute-state";
import { useWalletAccount } from "@/integrations/wallet/wallet-provider";
import { formatAddress, formatUsd } from "@/lib/format";

/**
 * The dispute surface for a graduated market whose resolution has been
 * proposed but not finalized. Driven entirely by on-chain reads — the indexed
 * market status has no pending/disputed states yet (ADR 0024 Phase 2), and a
 * bond is real money, so the countdown and the amount must come from the
 * contract that enforces them. Renders nothing outside an open window.
 */
export function MarketDisputePanel({ market }: { market: Market }) {
  const wallet = useWalletAccount();
  const [refreshKey, setRefreshKey] = useState(0);
  const marketAddress = market.postgrad?.marketAddress ?? null;
  const { snapshot } = useMarketDisputeState({
    marketAddress: marketAddress as `0x${string}` | null,
    refreshKey,
  });
  const { dispute, error, status, step } = useDispute({
    onDisputed: () => setRefreshKey((value) => value + 1),
  });
  const remainingMs = useCountdown(snapshot?.deadline ?? null);

  if (!snapshot || snapshot.phase === "none" || !marketAddress) {
    return null;
  }

  const proposedLabel = snapshot.proposedSide
    ? marketSideLabel(market, snapshot.proposedSide)
    : "an outcome";

  const isDisputer =
    snapshot.disputer !== null &&
    wallet.address?.toLowerCase() === snapshot.disputer.toLowerCase();

  if (snapshot.phase === "disputed") {
    return (
      <Panel tone="var(--danger)" title="Resolution disputed">
        <p className="text-sm leading-6 text-[var(--text-secondary)]">
          {isDisputer ? "You disputed" : "Someone disputed"} the proposed{" "}
          {proposedLabel} outcome
          {isDisputer || !snapshot.disputer
            ? ""
            : ` (${formatAddress(snapshot.disputer)})`}
          , so finalization is frozen until an operator settles the market. Redemption
          opens once it does.
        </p>
        {isDisputer && snapshot.bondHeld > 0n ? (
          <p className="mt-3 text-[12px] leading-5 text-[var(--text-secondary)]">
            Your{" "}
            <span className="font-mono font-bold text-[var(--text-primary)]">
              {formatBond(snapshot.bondHeld, snapshot.collateralDecimals)}
            </span>{" "}
            bond is held by the market: refunded if the operator settles to a different
            outcome, forfeited to the protocol owner if the proposed {proposedLabel}{" "}
            outcome stands.
          </p>
        ) : null}
      </Panel>
    );
  }

  const bondUsd = formatBond(snapshot.bond, snapshot.collateralDecimals);
  const isResolver = wallet.address?.toLowerCase() === snapshot.resolver.toLowerCase();
  const windowClosed = remainingMs <= 0;
  const pending = status === "pending";

  return (
    <Panel tone="var(--warning)" title="Resolution proposed">
      <p className="text-sm leading-6 text-[var(--text-secondary)]">
        This market is proposed to resolve{" "}
        <span className="font-bold text-[var(--text-primary)]">{proposedLabel}</span>.
        It finalizes automatically{" "}
        {windowClosed ? (
          "— the dispute window has closed."
        ) : (
          <>
            in{" "}
            <span className="font-mono font-bold text-[var(--text-primary)]">
              {formatRemaining(remainingMs)}
            </span>
            , and until then anyone can dispute it.
          </>
        )}
      </p>

      <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--danger)] bg-[var(--surface-raised)] p-3">
        <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.14em] text-[var(--danger)] uppercase">
          <ShieldAlert size={14} /> Your money is at risk
        </div>
        <p className="mt-2 text-[12px] leading-5 text-[var(--text-secondary)]">
          {isResolver ? (
            <>
              You are this market&apos;s resolver, so your dispute posts no bond.
              Disputing freezes finalization for manual settlement.
            </>
          ) : (
            <>
              Disputing transfers a{" "}
              <span className="font-mono font-bold text-[var(--text-primary)]">
                {bondUsd}
              </span>{" "}
              bond from your wallet to this market. You get it back only if the operator
              settles the market to a different outcome. If the proposed {proposedLabel}{" "}
              outcome stands, the bond is forfeited to the protocol owner and you do not
              get it back.
            </>
          )}
        </p>
      </div>

      <button
        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[var(--danger)] px-4 py-2.5 font-mono text-[13px] font-bold text-[var(--danger)] transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={pending || windowClosed || !wallet.address}
        onClick={() => dispute(marketAddress as `0x${string}`)}
        type="button"
      >
        {pending ? (
          <>
            <Loader2 size={15} className="animate-spin" />
            {step === "approving" ? "Approving bond…" : "Disputing…"}
          </>
        ) : (
          <>
            <Gavel size={15} />
            {isResolver ? "Dispute (no bond)" : `Dispute with a ${bondUsd} bond`}
          </>
        )}
      </button>

      {!wallet.address ? (
        <p className="mt-2 font-mono text-[11px] leading-5 text-[var(--text-muted)]">
          Connect a wallet to dispute this resolution.
        </p>
      ) : null}

      {error ? (
        <p className="mt-3 text-[12px] leading-5 text-[var(--danger)]">{error}</p>
      ) : null}
    </Panel>
  );
}

function Panel({
  children,
  title,
  tone,
}: {
  children: ReactNode;
  title: string;
  tone: string;
}) {
  return (
    <section
      className="rounded-[var(--radius-lg)] border bg-[var(--surface-card)] p-5"
      style={{ borderColor: tone }}
    >
      <div
        className="mb-3 font-mono text-[10px] tracking-[0.14em] uppercase"
        style={{ color: tone }}
      >
        {title}
      </div>
      {children}
    </section>
  );
}

/**
 * Milliseconds left until `deadline` (unix seconds), ticking once a second so
 * the window visibly closes without a page reload. Zero when no window is
 * open, which the caller reads as closed.
 */
function useCountdown(deadline: number | null) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (deadline === null) {
      return;
    }

    const timer = window.setInterval(() => setNow(Date.now()), 1_000);

    return () => window.clearInterval(timer);
  }, [deadline]);

  return deadline === null ? 0 : Math.max(deadline * 1_000 - now, 0);
}

/** Formats a raw-collateral bond amount as dollars at the token's precision. */
function formatBond(amount: bigint, collateralDecimals: number) {
  return formatUsd(Number(formatUnits(amount, collateralDecimals)));
}

function formatRemaining(remainingMs: number) {
  const totalSeconds = Math.floor(remainingMs / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => value.toString().padStart(2, "0");

  return hours > 0
    ? `${hours}h ${pad(minutes)}m ${pad(seconds)}s`
    : `${minutes}m ${pad(seconds)}s`;
}
