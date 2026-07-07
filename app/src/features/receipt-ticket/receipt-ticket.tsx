"use client";

import { Loader2, ReceiptText, ShieldAlert, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { formatUnits } from "viem";
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
} from "@/domain/pregrad-trading/receipt-quote";
import { TOKEN_DECIMALS } from "@/domain/tokens/wad";
import { erc20Abi } from "@/integrations/contracts/erc20";
import { pregradManagerAbi } from "@/integrations/contracts/pregrad-manager";
import { useWalletAccount } from "@/integrations/wallet/wallet-provider";
import { cn } from "@/lib/cn";
import { formatUsd } from "@/lib/format";

import {
  canMintLocalCollateral,
  mintLocalCollateral,
  placePregradReceipt,
  type PlaceReceiptWallet,
  type ReceiptPlacementStep,
  resolveTradingEnvironment,
} from "./place-receipt-service";
import {
  getMaxPresetAmount,
  getReceiptAction,
  getReceiptPlacementErrorMessage,
} from "./receipt-action";
import { recordPlacedReceipt } from "./receipt-storage";
import { formatPlacementStep, formatPresetAmount } from "./receipt-ticket-format";
import {
  CollateralBalancePanel,
  PlacedReceiptNotice,
  QuotePreview,
} from "./receipt-ticket-panels";

const sideOptions = [
  { label: "YES", value: "yes" },
  { label: "NO", value: "no" },
];

const presetAmounts = ["50", "250", "1000", "Max"] as const;
const TEST_MINT_AMOUNT_USD = 10_000;
const marketStatusLabels: Record<Market["status"], string> = {
  under_review: "under review",
  bootstrap: "bootstrap",
  cancelled: "cancelled",
  graduated: "graduated",
  graduating: "graduating",
  refunded: "refunded",
  rejected: "rejected",
  resolved: "resolved",
};

type ContractTicketStatus = {
  balance: bigint | null;
  error: string | null;
  loading: boolean;
  marketExists: boolean | null;
};

type ContractTicketReadResult = Omit<ContractTicketStatus, "loading"> & {
  requestKey: string | null;
};

/**
 * The pre-graduation trade ticket for one market: side and budget entry, a
 * live quote preview, and receipt placement against the devchain
 * PregradManager (with balance and market-existence checks) or the mock
 * environment. Placed receipts are priced intents, not fills.
 */
export function ReceiptTicket({ market }: { market: Market }) {
  const router = useRouter();
  const wallet = useWalletAccount();
  const [amount, setAmount] = useState("250");
  const [side, setSide] = useState<MarketSide>("yes");
  const [isPlacing, setIsPlacing] = useState(false);
  const [isMinting, setIsMinting] = useState(false);
  const [placementStep, setPlacementStep] = useState<ReceiptPlacementStep | null>(null);
  const [placedReceipt, setPlacedReceipt] = useState<PlacedPregradReceipt | null>(null);
  const [statusRefreshKey, setStatusRefreshKey] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [contractReadResult, setContractReadResult] =
    useState<ContractTicketReadResult>({
      balance: null,
      error: null,
      marketExists: null,
      requestKey: null,
    });
  const environment = useMemo(() => resolveTradingEnvironment(market), [market]);
  const contractChainId =
    environment.kind === "contract" ? environment.config.chainId : undefined;
  const contractConfig = environment.kind === "contract" ? environment.config : null;
  const contractMarketId =
    environment.kind === "contract" ? environment.marketId : null;
  const publicClient = usePublicClient({ chainId: contractChainId });
  const { data: walletClient } = useWalletClient({ chainId: contractChainId });
  const contractStatusRequestKey =
    contractConfig && contractMarketId !== null && wallet.address && publicClient
      ? [
          contractConfig.chainId,
          contractConfig.collateralAddress,
          contractConfig.pregradManagerAddress,
          contractMarketId.toString(),
          wallet.address,
          statusRefreshKey,
        ].join(":")
      : null;
  const contractStatus: ContractTicketStatus =
    contractStatusRequestKey === null
      ? {
          balance: null,
          error: null,
          loading: false,
          marketExists: null,
        }
      : contractReadResult.requestKey === contractStatusRequestKey
        ? {
            balance: contractReadResult.balance,
            error: contractReadResult.error,
            loading: false,
            marketExists: contractReadResult.marketExists,
          }
        : {
            balance: null,
            error: null,
            loading: true,
            marketExists: null,
          };
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
  const balanceUsd =
    contractStatus.balance === null
      ? null
      : Number(formatUnits(contractStatus.balance, TOKEN_DECIMALS));
  const insufficientBalance =
    environment.kind === "contract" &&
    Boolean(wallet.address) &&
    balanceUsd !== null &&
    quote !== null &&
    quote.maxCostUsd > balanceUsd + 0.000001;
  const insufficientBalanceMessage =
    insufficientBalance && balanceUsd !== null && quote
      ? `Max cost is ${formatUsd(quote.maxCostUsd)}, but your wallet has ${formatUsd(
          balanceUsd
        )} pUSD.`
      : null;
  const contractMarketMissing =
    environment.kind === "contract" && contractStatus.marketExists === false;
  const amountFieldError =
    market.status === "bootstrap"
      ? (amountError ?? insufficientBalanceMessage ?? undefined)
      : undefined;
  const canMintTestPusd =
    contractConfig !== null &&
    Boolean(wallet.address) &&
    wallet.isSupportedChain &&
    publicClient !== undefined &&
    walletClient !== undefined &&
    canMintLocalCollateral(contractConfig);
  const receiptAction = getReceiptAction({
    amountError,
    contractMarketMissing,
    environment,
    insufficientBalance,
    isPlacing,
    marketStatus: market.status,
    onPlace: handlePlaceReceipt,
    publicClientReady: Boolean(publicClient),
    quote,
    side,
    wallet,
    walletClientReady: Boolean(walletClient),
  });

  useEffect(() => {
    let isActive = true;

    if (
      !contractStatusRequestKey ||
      !contractConfig ||
      contractMarketId === null ||
      !wallet.address ||
      !publicClient
    ) {
      return;
    }

    Promise.all([
      publicClient.readContract({
        abi: erc20Abi,
        address: contractConfig.collateralAddress,
        functionName: "balanceOf",
        args: [wallet.address as `0x${string}`],
      }),
      publicClient.readContract({
        abi: pregradManagerAbi,
        address: contractConfig.pregradManagerAddress,
        functionName: "marketExists",
        args: [contractMarketId],
      }),
    ])
      .then(([balance, marketExists]) => {
        if (!isActive) {
          return;
        }

        setContractReadResult({
          balance,
          error: null,
          marketExists,
          requestKey: contractStatusRequestKey,
        });
      })
      .catch((error: unknown) => {
        if (!isActive) {
          return;
        }

        setContractReadResult({
          balance: null,
          error: getReceiptPlacementErrorMessage(error),
          marketExists: null,
          requestKey: contractStatusRequestKey,
        });
      });

    return () => {
      isActive = false;
    };
  }, [
    contractConfig,
    contractMarketId,
    contractStatusRequestKey,
    publicClient,
    wallet.address,
  ]);

  function updateAmount(value: string) {
    setAmount(value.replace(/[^0-9.]/g, ""));
    setPlacedReceipt(null);
    setSubmitError(null);
  }

  function selectPresetAmount(preset: (typeof presetAmounts)[number]) {
    if (preset !== "Max") {
      updateAmount(preset);
      return;
    }

    updateAmount(formatPresetAmount(getMaxPresetAmount(balanceUsd)));
  }

  async function handleMintTestPusd() {
    if (
      environment.kind !== "contract" ||
      !wallet.address ||
      !publicClient ||
      !walletClient
    ) {
      return;
    }

    setIsMinting(true);
    setPlacementStep(null);
    setPlacedReceipt(null);
    setSubmitError(null);

    try {
      await mintLocalCollateral({
        amountUsd: TEST_MINT_AMOUNT_USD,
        config: environment.config,
        onStep: setPlacementStep,
        wallet: {
          accountAddress: wallet.address as `0x${string}`,
          activeChainId: wallet.activeChainId,
          publicClient,
          walletClient,
        },
      });
      setStatusRefreshKey((value) => value + 1);
    } catch (error) {
      setSubmitError(getReceiptPlacementErrorMessage(error));
    } finally {
      setIsMinting(false);
      setPlacementStep(null);
    }
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
      setStatusRefreshKey((value) => value + 1);
      router.refresh();
      window.setTimeout(() => router.refresh(), 1_500);
      window.setTimeout(() => router.refresh(), 4_000);
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
        error={amountFieldError}
        id="receipt-amount"
        label="Collateral budget"
        mono
        onChange={(event) => updateAmount(event.target.value)}
        suffix="pUSD"
        value={amount}
      />

      <div className="grid grid-cols-4 gap-2">
        {presetAmounts.map((preset) => {
          const presetAmount =
            preset === "Max"
              ? formatPresetAmount(getMaxPresetAmount(balanceUsd))
              : preset;

          return (
            <button
              className={cn(
                "focus-ring rounded-[var(--radius-sm)] border border-[var(--border)] px-2 py-2 font-mono text-xs text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)]",
                presetAmount === amount
                  ? "border-[var(--pc-cyan)] text-[var(--pc-cyan)]"
                  : null
              )}
              key={preset}
              onClick={() => selectPresetAmount(preset)}
              type="button"
            >
              {preset}
            </button>
          );
        })}
      </div>

      {environment.kind === "contract" ? (
        <CollateralBalancePanel
          balanceUsd={balanceUsd}
          canMint={canMintTestPusd}
          error={contractStatus.error}
          isLoading={contractStatus.loading}
          isMinting={isMinting}
          onMint={handleMintTestPusd}
          walletConnected={Boolean(wallet.address)}
        />
      ) : null}

      <QuotePreview quote={quote} sideColor={sideColor} />

      {contractMarketMissing ? (
        <div className="flex gap-2 rounded-[var(--radius-sm)] border border-[var(--no-border)] bg-[var(--no-bg)] p-3 text-[12px] leading-5 text-[var(--no)]">
          <TriangleAlert className="mt-0.5 shrink-0" size={14} />
          <span>
            This market is not on the current local PregradManager. Create a new market,
            then trade that fresh market.
          </span>
        </div>
      ) : null}

      {submitError ? (
        <div className="flex gap-2 rounded-[var(--radius-sm)] border border-[var(--no-border)] bg-[var(--no-bg)] p-3 text-[12px] leading-5 text-[var(--no)]">
          <TriangleAlert className="mt-0.5 shrink-0" size={14} />
          <span>{submitError}</span>
        </div>
      ) : null}

      {placedReceipt ? <PlacedReceiptNotice receipt={placedReceipt} /> : null}

      {market.status !== "bootstrap" ? (
        <div className="rounded-[var(--radius-sm)] border border-[var(--status-graduating)] bg-[var(--pc-amber-wash)] p-3 text-[12px] leading-5 text-[var(--status-graduating)]">
          This receipt book is locked because the market is{" "}
          {marketStatusLabels[market.status]}.
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
