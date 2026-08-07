"use client";

import { Gavel, Loader2, RotateCw, ShieldAlert } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { formatUnits } from "viem";

import { type Market, marketSideLabel } from "@/domain/markets/types";
import { useDispute } from "@/integrations/contracts/hooks/use-dispute";
import { useMarketDisputeState } from "@/integrations/contracts/hooks/use-market-dispute-state";
import { useWalletAccount } from "@/integrations/wallet/wallet-provider";
import { formatAddress } from "@/lib/format";

import { MarketSettleAction } from "./market-settle-action";
import {
  settleMarketAction,
  type SettleMarketActionResult,
} from "./resolution-actions";
import { ResolutionPanelShell } from "./resolution-panel-shell";

/**
 * The resolution surface for a graduated market whose outcome has been
 * proposed but not settled. It carries both public actions the window allows,
 * in the order the window reaches them: dispute the proposal while the window
 * is open, and settle the market once it closes.
 *
 * Driven entirely by on-chain reads — the indexed market status has no
 * pending/disputed states yet (ADR 0024 Phase 2), and a bond is real money, so
 * the countdown and the amount must come from the contract that enforces them.
 * Reading the chain is also what makes the settle action worth offering: the
 * keeper finds markets to settle through the indexed status, so a market the
 * indexer missed is one nothing settles automatically, and this panel is the
 * only surface that can still see it. Only the settle *write* goes to the
 * server.
 *
 * Renders nothing outside a live proposal, with two deliberate exceptions. A
 * *failed* read is never silent, because rendering it as an ordinary graduated
 * market hides a window the viewer could still act in. And a settlement this
 * viewer just triggered keeps its confirmation, because the contract has left
 * the pending state by then and the panel would otherwise vanish mid-click.
 */
export function MarketResolutionPanel({ market }: { market: Market }) {
  const wallet = useWalletAccount();
  const [refreshKey, setRefreshKey] = useState(0);
  const reread = () => setRefreshKey((value) => value + 1);
  const marketAddress = market.postgrad?.marketAddress ?? null;
  const { error: readError, snapshot } = useMarketDisputeState({
    marketAddress: marketAddress as `0x${string}` | null,
    refreshKey,
  });
  const { dispute, error, status, step } = useDispute({ onDisputed: reread });
  const settlement = useSettlement({ marketId: market.id, onSettled: reread });
  const remainingMs = useCountdown(snapshot?.deadline ?? null);

  if (!marketAddress) {
    return null;
  }

  const proposedLabel = snapshot?.proposedSide
    ? marketSideLabel(market, snapshot.proposedSide)
    : "an outcome";

  // Ahead of every read-driven branch on purpose. A confirmed settlement moves
  // the contract to Resolved, so the next read reports `none` — or fails —
  // and either would blank the panel out from under the person who just
  // pressed. Redemption is driven by the indexed status, which can lag the
  // chain by a sweep or more (and this button exists for the case where that
  // lag is the whole problem), so the confirmation has to say what happened
  // rather than leave a space that reads as a failed click.
  if (settlement.outcome?.status === "settled") {
    return (
      <MarketSettleAction
        onSettle={settlement.settle}
        outcome={settlement.outcome}
        pending={settlement.pending}
        proposedLabel={proposedLabel}
      />
    );
  }

  // A failed read is not the same as "no window is open", and rendering both
  // as an empty page is how a holder settles against an outcome they never
  // knew they could contest: the reads reject the whole snapshot on a single
  // RPC hiccup, or on a market that finalizes between the status read and the
  // proposal reads. Say so, and give them a way back in.
  if (readError) {
    return (
      <ResolutionPanelShell tone="var(--danger)" title="Resolution status unavailable">
        <p className="text-sm leading-6 text-[var(--text-secondary)]">{readError}</p>
        <p className="mt-2 text-[12px] leading-5 text-[var(--text-secondary)]">
          A dispute window may be open on this market. Retry before assuming there is
          nothing to contest — once the window closes, the proposed outcome stands.
        </p>
        <button
          className="mt-3 inline-flex items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[var(--danger)] px-4 py-2 font-mono text-[13px] font-bold text-[var(--danger)] transition-opacity hover:opacity-85"
          onClick={reread}
          type="button"
        >
          <RotateCw size={15} /> Check again
        </button>
      </ResolutionPanelShell>
    );
  }

  if (!snapshot || snapshot.phase === "none") {
    return null;
  }

  const isDisputer =
    snapshot.disputer !== null &&
    wallet.address?.toLowerCase() === snapshot.disputer.toLowerCase();

  if (snapshot.phase === "disputed") {
    return (
      <ResolutionPanelShell tone="var(--danger)" title="Resolution disputed">
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
      </ResolutionPanelShell>
    );
  }

  // The window has closed and the contract still says pending, so disputing is
  // over and settling is what is left. The previous behaviour here was a
  // disabled dispute button — a dead end for the only viewer who can still do
  // something about a market the keeper never picked up.
  if (remainingMs <= 0) {
    return (
      <MarketSettleAction
        onSettle={settlement.settle}
        outcome={settlement.outcome}
        pending={settlement.pending}
        proposedLabel={proposedLabel}
      />
    );
  }

  const bondUsd = formatBond(snapshot.bond, snapshot.collateralDecimals);
  const isResolver = wallet.address?.toLowerCase() === snapshot.resolver.toLowerCase();
  const pending = status === "pending";
  const blocker = getDisputeBlocker(wallet);

  return (
    <ResolutionPanelShell tone="var(--warning)" title="Resolution proposed">
      <p className="text-sm leading-6 text-[var(--text-secondary)]">
        This market is proposed to resolve{" "}
        <span className="font-bold text-[var(--text-primary)]">{proposedLabel}</span>.
        It finalizes automatically in{" "}
        <span className="font-mono font-bold text-[var(--text-primary)]">
          {formatRemaining(remainingMs)}
        </span>
        , and until then anyone can dispute it.
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
        disabled={pending || blocker !== null}
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

      {blocker ? (
        <p className="mt-2 font-mono text-[11px] leading-5 text-[var(--text-muted)]">
          {blocker.message}
        </p>
      ) : null}

      {error ? (
        <p className="mt-3 text-[12px] leading-5 text-[var(--danger)]">{error}</p>
      ) : null}
    </ResolutionPanelShell>
  );
}

/**
 * Drives the public settle request and holds its answer. The state lives here
 * rather than in {@link MarketSettleAction} because a successful settle takes
 * the contract out of the phase that renders that component at all.
 *
 * Only a settlement re-reads the chain. A refusal means the chain moved
 * without this caller, and the message explaining that is the useful thing on
 * screen — re-reading would replace it with whatever state won the race.
 */
function useSettlement({
  marketId,
  onSettled,
}: {
  marketId: string;
  onSettled: () => void;
}) {
  const [outcome, setOutcome] = useState<SettleMarketActionResult | null>(null);
  const [pending, startSettling] = useTransition();

  return {
    outcome,
    pending,
    settle: () => {
      setOutcome(null);
      startSettling(async () => {
        const result = await settleMarketAction(marketId);

        setOutcome(result);

        if (result.status === "settled") {
          onSettled();
        }
      });
    },
  };
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

/**
 * The one thing stopping this viewer from disputing, with the copy that says
 * so, or null when nothing does. The chain is checked here and not only inside
 * the service (which throws on a mismatch) because an ungated button lets a
 * wrong-chain holder click, sign nothing, and learn nothing — the house
 * pattern is `getWalletCreateAction` / `getVenueSwapAction`.
 *
 * Disputing only. Settling has no wallet gate at all: it moves no collateral,
 * signs nothing on the caller's behalf, and grants them nothing.
 */
function getDisputeBlocker(
  wallet: ReturnType<typeof useWalletAccount>
): { message: string } | null {
  if (!wallet.address) {
    return { message: "Connect a wallet to dispute this resolution." };
  }

  if (wallet.activeChainId !== wallet.defaultChain.id) {
    return {
      message: `Switch your wallet to ${wallet.defaultChain.name} to dispute this resolution.`,
    };
  }

  return null;
}

/**
 * Formats a raw-collateral bond as dollars at the token's exact precision.
 * Deliberately not `formatUsd`, which is lossy in both directions on the two
 * amounts that matter here: it drops cents at $100 and above (a 250.40 bond
 * renders "$250" while 250.40 is pulled) and rounds anything below half a cent
 * to "$0.00", which reads as free. Fractions shorter than two digits are
 * padded so the figure still reads as currency.
 */
function formatBond(amount: bigint, collateralDecimals: number) {
  const [whole = "0", fraction = ""] = formatUnits(amount, collateralDecimals).split(
    "."
  );

  return `$${BigInt(whole).toLocaleString("en-US")}.${fraction.padEnd(2, "0")}`;
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
