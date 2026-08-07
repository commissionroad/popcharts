"use client";

import { Gavel, Loader2, ShieldAlert } from "lucide-react";
import { formatUnits } from "viem";

import { type Market, marketSideLabel } from "@/domain/markets/types";
import { useDispute } from "@/integrations/contracts/hooks/use-dispute";
import type { MarketDisputeSnapshot } from "@/integrations/contracts/market-dispute-state";
import { useWalletAccount } from "@/integrations/wallet/wallet-provider";
import { formatAddress } from "@/lib/format";

import { ResolutionPanelShell } from "./resolution-panel-shell";

/**
 * The dispute surface for a proposed resolution, in whichever of its two states
 * the market is in: the open window anyone can contest for a bond, and the
 * frozen market a dispute already produced.
 *
 * Unlike settling, disputing is the caller's own money and the caller's own
 * signature, so it keeps the wallet gates and states the bond exactly.
 * {@link MarketResolutionPanel} owns the countdown that decides whether the
 * window is still open; this component renders what that decision means.
 */
export function MarketDisputeAction({
  market,
  marketAddress,
  onDisputed,
  remainingMs,
  snapshot,
}: {
  market: Market;
  marketAddress: `0x${string}`;
  /** Re-reads the chain once a dispute confirms. */
  onDisputed: () => void;
  remainingMs: number;
  snapshot: MarketDisputeSnapshot;
}) {
  const wallet = useWalletAccount();
  const { dispute, error, status, step } = useDispute({ onDisputed });
  const proposedLabel = snapshot.proposedSide
    ? marketSideLabel(market, snapshot.proposedSide)
    : "an outcome";
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
        onClick={() => dispute(marketAddress)}
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
