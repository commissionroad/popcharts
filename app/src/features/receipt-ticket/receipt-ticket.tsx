"use client";

import {
  CheckCircle2,
  Loader2,
  ReceiptText,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { usePublicClient, useWalletClient } from "wagmi";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { Market, MarketSide } from "@/domain/markets/types";
import {
  buildReceiptQuotePreview,
  DEFAULT_RECEIPT_SLIPPAGE_BPS,
  getReceiptAmountError,
  parseReceiptAmount,
  type PlacedPregradReceipt,
  type ReceiptQuotePreview,
} from "@/domain/pregrad-trading/receipt-quote";
import { useWalletAccount } from "@/integrations/wallet/wallet-provider";
import { cn } from "@/lib/cn";
import { formatAddress, formatCents, formatPercent, formatUsd } from "@/lib/format";

import {
  placePregradReceipt,
  type PlaceReceiptWallet,
  type ReceiptPlacementStep,
  resolveTradingEnvironment,
  type TradingEnvironment,
} from "./place-receipt-service";
import { recordPlacedReceipt } from "./receipt-storage";

const sideOptions = [
  { label: "YES", value: "yes" },
  { label: "NO", value: "no" },
];

const presetAmounts = ["50", "250", "1000", "Max"] as const;

export function ReceiptTicket({ market }: { market: Market }) {
  const router = useRouter();
  const wallet = useWalletAccount();
  const [amount, setAmount] = useState("250");
  const [side, setSide] = useState<MarketSide>("yes");
  const [isPlacing, setIsPlacing] = useState(false);
  const [placementStep, setPlacementStep] = useState<ReceiptPlacementStep | null>(null);
  const [placedReceipt, setPlacedReceipt] = useState<PlacedPregradReceipt | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const environment = useMemo(() => resolveTradingEnvironment(market), [market]);
  const contractChainId =
    environment.kind === "contract" ? environment.config.chainId : undefined;
  const publicClient = usePublicClient({ chainId: contractChainId });
  const { data: walletClient } = useWalletClient({ chainId: contractChainId });
  const amountError = getReceiptAmountError(amount);
  const numericAmount = parseReceiptAmount(amount);
  const quote = useMemo(
    () =>
      amountError || numericAmount === null
        ? null
        : buildReceiptQuotePreview({
            budgetUsd: numericAmount,
            market,
            side,
          }),
    [amountError, market, numericAmount, side]
  );
  const sideColor = side === "yes" ? "var(--yes)" : "var(--no)";
  const receiptAction = getReceiptAction({
    amountError,
    environment,
    isPlacing,
    marketStatus: market.status,
    onPlace: handlePlaceReceipt,
    publicClientReady: Boolean(publicClient),
    quote,
    side,
    wallet,
    walletClientReady: Boolean(walletClient),
  });

  function updateAmount(value: string) {
    setAmount(value.replace(/[^0-9.]/g, ""));
    setPlacedReceipt(null);
    setSubmitError(null);
  }

  async function handlePlaceReceipt() {
    if (!quote) {
      return;
    }

    setIsPlacing(true);
    setPlacementStep(null);
    setPlacedReceipt(null);
    setSubmitError(null);

    try {
      const walletContext =
        environment.kind === "contract" &&
        wallet.address &&
        publicClient &&
        walletClient
          ? ({
              accountAddress: wallet.address as `0x${string}`,
              activeChainId: wallet.activeChainId,
              publicClient,
              walletClient,
            } satisfies PlaceReceiptWallet)
          : undefined;
      const receipt = await placePregradReceipt({
        market,
        options: {
          onStep: setPlacementStep,
          slippageBps: DEFAULT_RECEIPT_SLIPPAGE_BPS,
          ...(walletContext ? { wallet: walletContext } : {}),
        },
        quote,
        side,
      });

      recordPlacedReceipt(receipt);
      setPlacedReceipt(receipt);
      router.refresh();
    } catch (error) {
      setSubmitError(getReceiptPlacementErrorMessage(error));
    } finally {
      setIsPlacing(false);
      setPlacementStep(null);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)] p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-mono text-[10px] tracking-[0.14em] text-[var(--text-muted)] uppercase">
            Place a receipt
          </div>
          <p className="mt-1 text-[12px] leading-5 text-[var(--text-secondary)]">
            {environment.kind === "contract"
              ? "Wallet-signed pre-graduation intent."
              : "Fixture-backed trading preview."}
          </p>
        </div>
        <span className="rounded-[var(--radius-pill)] border border-[var(--border)] px-2.5 py-1 font-mono text-[10px] tracking-[0.08em] text-[var(--text-muted)] uppercase">
          {environment.kind === "contract" ? "Devchain" : "Mock"}
        </span>
      </div>

      <SegmentedControl
        accentBy={(value) => (value === "yes" ? "var(--yes)" : "var(--no)")}
        full
        onChange={(value) => {
          setSide(value === "no" ? "no" : "yes");
          setPlacedReceipt(null);
          setSubmitError(null);
        }}
        options={sideOptions}
        value={side}
      />

      <Field
        error={market.status === "bootstrap" ? (amountError ?? undefined) : undefined}
        id="receipt-amount"
        label="Collateral budget"
        mono
        onChange={(event) => updateAmount(event.target.value)}
        suffix="pUSD"
        value={amount}
      />

      <div className="grid grid-cols-4 gap-2">
        {presetAmounts.map((preset) => {
          const presetAmount = preset === "Max" ? "5000" : preset;

          return (
            <button
              className={cn(
                "focus-ring rounded-[var(--radius-sm)] border border-[var(--border)] px-2 py-2 font-mono text-xs text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)]",
                presetAmount === amount
                  ? "border-[var(--pc-cyan)] text-[var(--pc-cyan)]"
                  : null
              )}
              key={preset}
              onClick={() => updateAmount(presetAmount)}
              type="button"
            >
              {preset}
            </button>
          );
        })}
      </div>

      <QuotePreview quote={quote} sideColor={sideColor} />

      {submitError ? (
        <div className="flex gap-2 rounded-[var(--radius-sm)] border border-[var(--no-border)] bg-[var(--no-bg)] p-3 text-[12px] leading-5 text-[var(--no)]">
          <TriangleAlert className="mt-0.5 shrink-0" size={14} />
          <span>{submitError}</span>
        </div>
      ) : null}

      {placedReceipt ? <PlacedReceiptNotice receipt={placedReceipt} /> : null}

      {market.status !== "bootstrap" ? (
        <div className="rounded-[var(--radius-sm)] border border-[var(--status-graduating)] bg-[var(--pc-amber-wash)] p-3 text-[12px] leading-5 text-[var(--status-graduating)]">
          This receipt book is locked because the market is {market.status}.
        </div>
      ) : null}

      <Button
        className="w-full"
        disabled={receiptAction.disabled}
        glow={false}
        leftIcon={
          isPlacing ? (
            <Loader2 className="animate-spin" size={17} />
          ) : (
            <ReceiptText size={17} />
          )
        }
        onClick={receiptAction.onClick}
        style={{
          background: sideColor,
          boxShadow: side === "yes" ? "var(--glow-lime)" : "var(--glow-magenta)",
        }}
      >
        {receiptAction.label}
      </Button>

      {placementStep ? (
        <div className="font-mono text-[11px] text-[var(--text-muted)]">
          {formatPlacementStep(placementStep)}
        </div>
      ) : null}

      <div className="flex gap-2.5">
        <ShieldAlert className="mt-0.5 shrink-0 text-[var(--text-muted)]" size={15} />
        <p className="text-[11.5px] leading-5 text-[var(--text-muted)]">
          Not a guaranteed fill. Clears at graduation; worst case is a full refund at
          your exact path cost.
        </p>
      </div>
    </section>
  );
}

function QuotePreview({
  quote,
  sideColor,
}: {
  quote: ReceiptQuotePreview | null;
  sideColor: string;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-md)] bg-[var(--surface-raised)] p-4">
      <TicketRow
        label="Avg price"
        value={quote ? formatCents(quote.averagePriceCents) : "--"}
      />
      <TicketRow
        label="Est. receipt shares"
        tone={sideColor}
        value={quote ? `${formatShares(quote.shares)} sh` : "--"}
      />
      <TicketRow label="Price band" value={quote ? formatPriceBand(quote) : "--"} />
      <TicketRow
        label="Price impact"
        tone={
          quote && quote.priceImpactCents >= 5 ? "var(--status-graduating)" : undefined
        }
        value={quote ? `+${quote.priceImpactCents.toFixed(2)} pts` : "--"}
      />
      <TicketRow label="Max cost" value={quote ? formatUsd(quote.maxCostUsd) : "--"} />
    </div>
  );
}

function PlacedReceiptNotice({ receipt }: { receipt: PlacedPregradReceipt }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--pc-lime)] bg-[var(--pc-lime-wash)] p-3">
      <div className="flex items-center gap-2 font-mono text-[12px] font-bold text-[var(--pc-lime)]">
        <CheckCircle2 size={15} />
        Receipt placed
      </div>
      <div className="mt-2 grid gap-1 text-[12px] text-[var(--text-secondary)]">
        <span>
          #{receipt.receiptId} - {formatUsd(receipt.collateralUsd)} -{" "}
          {formatShares(receipt.shares)} sh
        </span>
        {receipt.transactionHash ? (
          <span className="font-mono text-[11px] text-[var(--text-muted)]">
            Tx {formatAddress(receipt.transactionHash)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function getReceiptAction({
  amountError,
  environment,
  isPlacing,
  marketStatus,
  onPlace,
  publicClientReady,
  quote,
  side,
  wallet,
  walletClientReady,
}: {
  amountError: string | null;
  environment: TradingEnvironment;
  isPlacing: boolean;
  marketStatus: Market["status"];
  onPlace: () => void;
  publicClientReady: boolean;
  quote: ReceiptQuotePreview | null;
  side: MarketSide;
  wallet: ReturnType<typeof useWalletAccount>;
  walletClientReady: boolean;
}) {
  const sideLabel = side === "yes" ? "YES" : "NO";

  if (marketStatus !== "bootstrap") {
    return {
      disabled: true,
      label: "Receipt book locked",
      onClick: undefined,
    };
  }

  if (isPlacing) {
    return {
      disabled: true,
      label: "Placing receipt",
      onClick: undefined,
    };
  }

  if (amountError || !quote) {
    return {
      disabled: true,
      label: `Place ${sideLabel} receipt`,
      onClick: undefined,
    };
  }

  if (environment.kind === "mock") {
    return {
      disabled: false,
      label: `Place mock ${sideLabel} receipt`,
      onClick: onPlace,
    };
  }

  if (!wallet.enabled) {
    return {
      disabled: true,
      label: "Sign in unavailable",
      onClick: undefined,
    };
  }

  if (!wallet.ready) {
    return {
      disabled: true,
      label: "Preparing wallet",
      onClick: undefined,
    };
  }

  if (!wallet.authenticated) {
    return {
      disabled: false,
      label: "Sign in to place receipt",
      onClick: wallet.login,
    };
  }

  if (!wallet.address) {
    return {
      disabled: false,
      label: "Create or link wallet",
      onClick: wallet.connectOrCreateWallet,
    };
  }

  if (!wallet.isSupportedChain) {
    return {
      disabled: Boolean(wallet.pendingAction),
      label: `Switch to ${wallet.defaultChain.name}`,
      onClick: () => void wallet.switchChain(wallet.defaultChain.id),
    };
  }

  if (!publicClientReady || !walletClientReady) {
    return {
      disabled: true,
      label: "Preparing trading client",
      onClick: undefined,
    };
  }

  return {
    disabled: false,
    label: `Place ${sideLabel} receipt`,
    onClick: onPlace,
  };
}

function TicketRow({
  label,
  tone = "var(--text-primary)",
  value,
}: {
  label: string;
  tone?: string | undefined;
  value: string;
}) {
  return (
    <div className="flex justify-between gap-4 text-[13px]">
      <span className="font-mono text-[var(--text-muted)]">{label}</span>
      <span className="tabular text-right font-mono" style={{ color: tone }}>
        {value}
      </span>
    </div>
  );
}

function formatPlacementStep(step: ReceiptPlacementStep) {
  const labels: Record<ReceiptPlacementStep, string> = {
    approving: "Approving pUSD spend...",
    confirming: "Waiting for confirmation...",
    minting: "Minting local test pUSD...",
    placing: "Submitting receipt...",
    quoting: "Refreshing chain quote...",
  };

  return labels[step];
}

function formatPriceBand(quote: ReceiptQuotePreview) {
  return `${formatPercent(quote.priceBand.fromProbability)} to ${formatPercent(
    quote.priceBand.toProbability
  )}`;
}

function formatShares(value: number) {
  if (value >= 1_000) {
    return value.toLocaleString("en-US", {
      maximumFractionDigits: 0,
    });
  }

  return value.toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
}

function getReceiptPlacementErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Could not place receipt.";
}
