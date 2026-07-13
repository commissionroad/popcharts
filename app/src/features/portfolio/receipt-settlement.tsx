import type { PortfolioReceipt } from "@popcharts/api-client/models";

import { wadToNumber } from "@/domain/tokens/wad";
import { formatTokenAmount, formatUsd } from "@/lib/format";

/**
 * The plain-language result of a receipt's lifecycle: a headline plus an
 * optional detail line. Settled receipts show what the receipt *became* —
 * retained outcome tokens plus any refunded remainder — instead of a perpetual
 * "waiting" state; a claimed refund shows the amount returned; the claimable
 * and refund-claimable states point the holder at the market page, where the
 * claims themselves happen. Kept as a pure derivation so both the portfolio
 * table and the market-detail panel render the exact same result.
 */
export function receiptSettlementResult(receipt: PortfolioReceipt): {
  detail?: string;
  label: string;
} {
  if (receipt.status === "settled" && receipt.settlement) {
    const refund = BigInt(receipt.settlement.refund);
    const retained = formatTokenAmount(
      BigInt(receipt.settlement.retainedShares ?? "0")
    );
    const refundNote =
      refund > 0n ? ` + ${formatUsd(wadToNumber(refund))} refunded` : "";

    return {
      detail: `${retained} ${receipt.side.toUpperCase()} tokens${refundNote}`,
      label: "Settled",
    };
  }

  if (receipt.status === "refunded" && receipt.settlement) {
    return {
      detail: `${formatUsd(wadToNumber(BigInt(receipt.settlement.refund)))} returned`,
      label: "Refunded",
    };
  }

  if (receipt.status === "claimable") {
    return { detail: "Ready to claim on the market page", label: "Graduated" };
  }

  // A market that refunded or was cancelled projects to `refund_claimable`
  // until the holder claims; the refund amount lands only once claimed
  // (`refunded`), so here we simply point them at the market page.
  if (receipt.status === "refund_claimable") {
    return { detail: "Claim on the market page", label: "Refund available" };
  }

  return { label: "Waiting for graduation" };
}

/**
 * Shared renderer for a receipt's settlement result, used by both the portfolio
 * receipts table and the market-detail position panel so the two surfaces stay
 * word-for-word identical. Renders a secondary-toned headline with an optional
 * muted, monospaced detail line beneath it.
 */
export function ReceiptSettlement({ receipt }: { receipt: PortfolioReceipt }) {
  const result = receiptSettlementResult(receipt);

  return (
    <span className="text-[var(--text-secondary)]">
      {result.label}
      {result.detail ? (
        <span className="block font-mono text-[11px] text-[var(--text-muted)]">
          {result.detail}
        </span>
      ) : null}
    </span>
  );
}
