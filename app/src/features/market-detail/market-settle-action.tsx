"use client";

import type { ResolutionFinalizeRefusedStatus } from "@popcharts/api-client/models";
import { BadgeCheck, Loader2 } from "lucide-react";

import type { SettleMarketActionResult } from "./resolution-actions";
import { ResolutionPanelShell } from "./resolution-panel-shell";

/**
 * What a viewer reads for each way the endpoint can decline to settle. Every
 * one of these is ordinary operation: the settle call is permissionless, so
 * the state can move between the page render and the request landing, and the
 * commonest refusal by far is that the keeper simply got there first.
 *
 * Keyed by the contract enum rather than passing the API's own message
 * through, so a new refusal kind is a type error here instead of
 * client-facing wording leaking onto a market page.
 */
const REFUSAL_COPY: Record<
  ResolutionFinalizeRefusedStatus,
  { message: string; title: string }
> = {
  already_resolved: {
    message:
      "This market was already settled — the keeper or another viewer got there first. Redemption opens here once the settlement is picked up.",
    title: "Already settled",
  },
  disputed: {
    message:
      "This resolution is disputed, so it cannot be settled from here. An operator settles a disputed market, and redemption opens once they do.",
    title: "Resolution disputed",
  },
  no_pending_proposal: {
    message: "This market has no proposed resolution to settle right now.",
    title: "Nothing to settle",
  },
  not_graduated: {
    message:
      "This market has not graduated, so there is no proposed resolution to settle.",
    title: "Nothing to settle",
  },
  window_open: {
    message:
      "The dispute window is still open on chain, so the proposal cannot be settled yet. Try again once it closes.",
    title: "Window still open",
  },
};

/**
 * Copy for a refusal kind this build does not know. Unreachable through the
 * generated types, but the status arrives over a wire, and a blank panel after
 * a press reads as a broken button.
 */
const UNKNOWN_REFUSAL = {
  message: "This market cannot be settled right now.",
  title: "Nothing to settle",
};

/**
 * The settle surface for a graduated market whose dispute window has closed
 * while the contract still says pending (repo ADR 0024). The keeper discovers
 * pending proposals from the *indexed* market status, so the only way a person
 * reaches this state at all is that the keeper does not know the market is
 * here: the market sits in ResolutionPending, winners cannot redeem, and
 * nothing anywhere logs an error. Offering the press is the recovery.
 *
 * Settling takes nothing from the caller and grants them nothing — the outcome
 * is the one already proposed on chain, and the server signs the
 * permissionless call. So there is no wallet gate, no chain gate, and nothing
 * to pay. Do not add one: a wallet prompt for an action with no upside is
 * friction that stops the only viewer who can unstick the market.
 *
 * Deliberately stateless. The press moves the contract out of ResolutionPending,
 * which makes the caller's own state read report `none` — so the outcome is
 * held by {@link MarketResolutionPanel}, which outlives that flip.
 */
export function MarketSettleAction({
  onSettle,
  outcome,
  pending,
  proposedLabel,
}: {
  onSettle: () => void;
  /** The last answer from the settle endpoint, or null before the first press. */
  outcome: SettleMarketActionResult | null;
  pending: boolean;
  /** Display label for the outcome the market is proposed to resolve to. */
  proposedLabel: string;
}) {
  if (outcome?.status === "settled") {
    return (
      <ResolutionPanelShell tone="var(--positive)" title="Market settled">
        <p className="text-sm leading-6 text-[var(--text-secondary)]">
          You settled this market to its proposed outcome. Redemption opens here once
          the settlement is picked up.
        </p>
      </ResolutionPanelShell>
    );
  }

  if (outcome?.status === "refused") {
    const copy = REFUSAL_COPY[outcome.reason] ?? UNKNOWN_REFUSAL;

    return (
      <ResolutionPanelShell tone="var(--text-muted)" title={copy.title}>
        <p className="text-sm leading-6 text-[var(--text-secondary)]">{copy.message}</p>
      </ResolutionPanelShell>
    );
  }

  return (
    <ResolutionPanelShell tone="var(--warning)" title="Ready to settle">
      <p className="text-sm leading-6 text-[var(--text-secondary)]">
        The dispute window has closed, and this market is proposed to resolve{" "}
        <span className="font-bold text-[var(--text-primary)]">{proposedLabel}</span>.
        It settles on its own shortly. If it has not, anyone can settle it from here —
        the outcome is the one already proposed, and settling costs you nothing.
      </p>

      <button
        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[var(--positive)] px-4 py-2.5 font-mono text-[13px] font-bold text-[var(--positive)] transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={pending}
        onClick={onSettle}
        type="button"
      >
        {pending ? (
          <>
            <Loader2 size={15} className="animate-spin" /> Settling…
          </>
        ) : (
          <>
            <BadgeCheck size={15} /> Settle this market
          </>
        )}
      </button>

      {outcome?.status === "error" ? (
        <p className="mt-3 text-[12px] leading-5 text-[var(--danger)]">
          {outcome.message}
        </p>
      ) : null}
    </ResolutionPanelShell>
  );
}
