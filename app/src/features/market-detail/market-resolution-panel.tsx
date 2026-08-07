"use client";

import { RotateCw } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

import { type Market, marketSideLabel } from "@/domain/markets/types";
import { useMarketDisputeState } from "@/integrations/contracts/hooks/use-market-dispute-state";

import { MarketDisputeAction } from "./market-dispute-action";
import { MarketSettleAction } from "./market-settle-action";
import {
  settleMarketAction,
  type SettleMarketActionResult,
} from "./resolution-actions";
import { ResolutionPanelShell } from "./resolution-panel-shell";

/**
 * The resolution surface for a graduated market whose outcome has been
 * proposed but not settled. It routes between the two public actions the
 * window allows, in the order the window reaches them: dispute the proposal
 * while it is open, settle the market once it closes.
 *
 * The routing reads the chain, not the projection. The indexed market carries
 * a coarse status and a *terminal* resolution and nothing else — no proposed
 * side, no deadline, no bond — and a bond is real money, so the countdown and
 * the amount have to come from the contract that enforces them.
 *
 * That read is also what makes the settle action worth offering. The keeper
 * finds markets to settle through the indexed status, so a proposal the
 * indexer missed is one nothing settles automatically (repo ADR 0024): the
 * market sits in ResolutionPending, winners cannot redeem, and nothing logs an
 * error. A chain-reading panel is the only surface that can still see it.
 * Only the settle *write* goes to the server.
 *
 * Renders nothing outside a live proposal, with two deliberate exceptions. A
 * *failed* read is never silent, because rendering it as an ordinary graduated
 * market hides a window the viewer could still act in. And a settlement this
 * viewer just triggered keeps its confirmation, because the contract has left
 * the pending state by then and the panel would otherwise vanish mid-click.
 */
export function MarketResolutionPanel({ market }: { market: Market }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const reread = () => setRefreshKey((value) => value + 1);
  const marketAddress = market.postgrad?.marketAddress ?? null;
  const { error: readError, snapshot } = useMarketDisputeState({
    marketAddress: marketAddress as `0x${string}` | null,
    refreshKey,
  });
  const settlement = useSettlement({ marketId: market.id, onSettled: reread });
  const remainingMs = useCountdown(snapshot?.deadline ?? null);

  if (!marketAddress) {
    return null;
  }

  const settleProps = {
    onSettle: settlement.settle,
    outcome: settlement.outcome,
    pending: settlement.pending,
    // Unused by the confirmation branch, which deliberately does not name a
    // side: the endpoint reports that it settled, never what it settled to.
    proposedLabel: snapshot?.proposedSide
      ? marketSideLabel(market, snapshot.proposedSide)
      : "an outcome",
  };

  // Ahead of every read-driven branch on purpose. A confirmed settlement moves
  // the contract to Resolved, so the next read reports `none` — or fails — and
  // either would blank the panel out from under the person who just pressed.
  // Redemption is driven by the indexed status, which can lag the chain by a
  // sweep or more (and this button exists for the case where that lag is the
  // whole problem), so the confirmation has to say what happened rather than
  // leave a space that reads as a failed click.
  if (settlement.outcome?.status === "settled") {
    return <MarketSettleAction {...settleProps} />;
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

  // The window has closed and the contract still says pending, so disputing is
  // over and settling is what is left. The previous behaviour here was a
  // disabled dispute button — a dead end for the only viewer who can still do
  // something about a market the keeper never picked up. A *disputed* market
  // falls through to the dispute surface instead: only an operator settles one.
  if (snapshot.phase === "pending" && remainingMs <= 0) {
    return <MarketSettleAction {...settleProps} />;
  }

  return (
    <MarketDisputeAction
      market={market}
      marketAddress={marketAddress as `0x${string}`}
      onDisputed={reread}
      remainingMs={remainingMs}
      snapshot={snapshot}
    />
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
