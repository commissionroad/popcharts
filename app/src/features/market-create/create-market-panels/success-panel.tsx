"use client";

import { CheckCircle2, Clock, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { CreatedMarket } from "@/domain/market-creation/types";
import { formatUsdWhole } from "@/lib/format";

import { formatDeadlineFromSeconds, ReviewRow } from "./shared";

/**
 * Post-creation sidebar: summarizes the created market (devchain transaction
 * or mock draft), surfaces any metadata sync failure, and offers reset and
 * view-market actions.
 */
export function SuccessPanel({
  onReset,
  result,
}: {
  onReset: () => void;
  result: CreatedMarket;
}) {
  const onChain = result.creationMode === "devchain";
  const walletSigned = result.creationSigner === "wallet";
  const marketHref =
    onChain && result.chainId
      ? `/markets/${encodeURIComponent(`${result.chainId}:${result.marketId}`)}`
      : undefined;
  const statusTone = onChain ? "var(--status-under-review)" : "var(--status-graduated)";

  return (
    <div
      className="flex flex-col gap-4 rounded-[var(--radius-lg)] border bg-[var(--surface-card)] p-6"
      style={{ borderColor: statusTone }}
    >
      <div className="flex items-center gap-3">
        <span
          className="flex size-10 items-center justify-center rounded-[var(--radius-sm)] text-[var(--pc-ink)]"
          style={{ backgroundColor: statusTone }}
        >
          {onChain ? <Clock size={20} /> : <CheckCircle2 size={20} />}
        </span>
        <div>
          <div className="font-mono text-[10px] tracking-[0.14em] text-[var(--text-muted)] uppercase">
            {onChain
              ? walletSigned
                ? "Wallet-signed"
                : "Devchain relay"
              : "Mock created"}
          </div>
          <h2 className="font-display text-xl font-black">
            {onChain ? "Market under review" : "Market draft ready"}
          </h2>
        </div>
      </div>

      <div className="flex flex-col divide-y divide-[var(--border-soft)] rounded-[var(--radius-md)] border border-[var(--border-soft)]">
        <ReviewRow label="Market ID" mono value={result.marketId} />
        {result.transactionHash ? (
          <ReviewRow label="Transaction" mono value={result.transactionHash} />
        ) : null}
        {result.creator ? (
          <ReviewRow label="Creator" mono value={result.creator} />
        ) : null}
        <ReviewRow label="Metadata hash" mono value={result.metadataHash} />
        <ReviewRow
          label="Target"
          value={`${formatUsdWhole(result.graduationThreshold)} matched market cap`}
        />
        <ReviewRow
          label="Graduation"
          value={formatDeadlineFromSeconds(result.protocolParams.graduationDeadline)}
        />
        <ReviewRow
          label="Resolution"
          value={formatDeadlineFromSeconds(result.protocolParams.resolutionTime)}
        />
        <ReviewRow
          label="AI resolution"
          value={result.protocolParams.bypassAiResolution ? "Bypassed" : "Assisted"}
        />
      </div>

      {result.metadataSyncError ? (
        <p className="rounded-[var(--radius-sm)] border border-[var(--status-graduating)] bg-[var(--pc-amber-wash)] px-3 py-2 text-sm text-[var(--status-graduating)]">
          Market was created, but its question did not sync to the API:{" "}
          {result.metadataSyncError}
        </p>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          className="flex-1"
          leftIcon={<RotateCcw size={18} />}
          onClick={onReset}
          size="lg"
          variant="secondary"
        >
          Create another
        </Button>
        {marketHref ? (
          <Button className="flex-1" href={marketHref} size="lg" variant="ghost">
            View market
          </Button>
        ) : (
          <Button className="flex-1" disabled size="lg" variant="ghost">
            View market
          </Button>
        )}
      </div>
    </div>
  );
}
