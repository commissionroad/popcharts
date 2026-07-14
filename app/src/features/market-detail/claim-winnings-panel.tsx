"use client";

import { BadgeCheck, Loader2 } from "lucide-react";

import { type Market, marketSideLabel } from "@/domain/markets/types";
import { wadToNumber } from "@/domain/tokens/wad";
import { usePortfolio } from "@/features/portfolio/use-portfolio";
import { configuredPopChartsChainId } from "@/integrations/contracts/config";
import { useRedemption } from "@/integrations/contracts/hooks/use-redemption";
import { useWalletAccount } from "@/integrations/wallet/wallet-provider";
import { parseApiMarketAppId } from "@/lib/app-id";
import { formatTokenAmount, formatUsd } from "@/lib/format";

/**
 * The resolved market's claim surface: winning-side tokens redeem 1:1 for
 * collateral straight from this panel, with the connected wallet signing the
 * postgrad market's `redeem` write. Losing-side holders see their outcome
 * spelled out instead of a dead end, and tokens still resting in open ask
 * orders are called out (they must be cancelled before they can redeem). The
 * panel hides for uninvolved or disconnected viewers, mirroring the position
 * panel's no-empty-chrome rule.
 */
export function ClaimWinningsPanel({ market }: { market: Market }) {
  const wallet = useWalletAccount();
  const { portfolio, refresh } = usePortfolio({
    chainId: configuredPopChartsChainId,
    owner: wallet.address,
  });
  const { error, redeem, result, status } = useRedemption({
    onRedeemed: refresh,
  });

  const resolution = market.resolution;
  const winningSide = resolution?.winningSide;
  const marketId = parseApiMarketAppId(market.id)?.marketId ?? null;
  const marketAddress =
    market.postgrad?.marketAddress ?? resolution?.postgradMarket ?? null;

  if (!resolution || !winningSide || !marketAddress || !marketId) {
    return null;
  }

  if (!wallet.address || !portfolio) {
    return null;
  }

  const positions = portfolio.positions.filter(
    (position) => position.marketId === marketId
  );
  const winning = positions.find((position) => position.side === winningSide);
  const losing = positions.find((position) => position.side !== winningSide);
  const held = winning ? BigInt(winning.heldBalance) : 0n;
  const committed = winning ? BigInt(winning.committedInOrders) : 0n;
  const claimed = status === "success";

  if (!winning && !losing && !claimed) {
    return null;
  }

  const winningLabel = marketSideLabel(market, winningSide);
  const pending = status === "pending";

  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--status-graduated)] bg-[var(--surface-card)] p-5">
      <div className="mb-3 font-mono text-[10px] tracking-[0.14em] text-[var(--status-graduated)] uppercase">
        Claim winnings
      </div>

      {claimed && result ? (
        <div className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
          <BadgeCheck size={16} className="text-[var(--status-graduated)]" />
          <span>
            {/* The payout value is derived from the burned outcome amount
                (always 18-decimal WAD, redeems 1:1) — the event's
                collateralAmount is raw collateral units whose precision
                varies by chain (6-decimal on Arc). */}
            Claimed{" "}
            <span className="font-display font-black">
              {formatUsd(wadToNumber(result.outcomeAmount))}
            </span>{" "}
            for {formatTokenAmount(result.outcomeAmount)} {winningLabel} tokens.
          </span>
        </div>
      ) : held > 0n ? (
        <>
          <p className="text-sm leading-6 text-[var(--text-secondary)]">
            You hold{" "}
            <span className="font-mono font-bold text-[var(--text-primary)]">
              {formatTokenAmount(held)}
            </span>{" "}
            winning {winningLabel} tokens. Each redeems 1:1 for collateral.
          </p>
          <button
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--status-graduated)] px-4 py-2.5 font-mono text-[13px] font-bold text-[var(--surface-card)] transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={pending}
            onClick={() =>
              redeem({
                amount: held,
                marketAddress: marketAddress as `0x${string}`,
                side: winningSide,
              })
            }
            type="button"
          >
            {pending ? (
              <>
                <Loader2 size={15} className="animate-spin" /> Claiming…
              </>
            ) : (
              `Claim ${formatUsd(wadToNumber(held))}`
            )}
          </button>
        </>
      ) : (
        <p className="text-sm leading-6 text-[var(--text-secondary)]">
          {committed > 0n
            ? "All of your winning tokens are resting in open orders."
            : `This market resolved ${winningLabel}. Your ${
                losing ? marketSideLabel(market, losing.side) : ""
              } tokens finished out of the money.`}
        </p>
      )}

      {committed > 0n && !claimed ? (
        <p className="mt-3 font-mono text-[11px] leading-5 text-[var(--text-muted)]">
          {formatTokenAmount(committed)} more {winningLabel} tokens are resting in open
          orders — cancel those orders to claim them too.
        </p>
      ) : null}

      {losing && held > 0n ? (
        <p className="mt-3 font-mono text-[11px] leading-5 text-[var(--text-muted)]">
          Your {marketSideLabel(market, losing.side)} tokens finished out of the money
          and cannot be redeemed.
        </p>
      ) : null}

      {error ? (
        <p className="mt-3 text-[12px] leading-5 text-[var(--danger)]">{error}</p>
      ) : null}
    </section>
  );
}
