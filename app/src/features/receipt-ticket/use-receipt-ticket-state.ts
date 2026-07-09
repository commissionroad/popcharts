"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { formatUnits } from "viem";
import { usePublicClient, useWalletClient } from "wagmi";

import type { Market, MarketSide } from "@/domain/markets/types";
import {
  buildReceiptQuotePreview,
  DEFAULT_RECEIPT_SLIPPAGE_BPS,
  getReceiptAmountError,
  parseReceiptAmount,
  type PlacedPregradReceipt,
} from "@/domain/pregrad-trading/receipt-quote";
import { TOKEN_DECIMALS } from "@/domain/tokens/wad";
import { subscribeToTestPusdMinted } from "@/features/dev-settings/test-pusd-events";
import { useContractMarketStatus } from "@/integrations/contracts/hooks/use-contract-market-status";
import { useWalletAccount } from "@/integrations/wallet/wallet-provider";
import { formatUsd } from "@/lib/format";

import {
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
import { formatPresetAmount } from "./receipt-ticket-format";

export const presetAmounts = ["50", "250", "1000", "Max"] as const;

/**
 * The receipt ticket's state machine: form state (side, budget), the live
 * quote and balance-derived validation, the primary receipt action, and the
 * placement/mint submission flows against the resolved trading environment
 * (devchain PregradManager or mock). Returns state plus actions so the
 * ReceiptTicket component stays purely presentational.
 */
export function useReceiptTicketState(market: Market) {
  const router = useRouter();
  const wallet = useWalletAccount();
  const [amount, setAmount] = useState("250");
  const [side, setSide] = useState<MarketSide>("yes");
  const [isPlacing, setIsPlacing] = useState(false);
  const [placementStep, setPlacementStep] = useState<ReceiptPlacementStep | null>(null);
  const [placedReceipt, setPlacedReceipt] = useState<PlacedPregradReceipt | null>(null);
  const [statusRefreshKey, setStatusRefreshKey] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const environment = useMemo(() => resolveTradingEnvironment(market), [market]);
  const contractChainId =
    environment.kind === "contract" ? environment.config.chainId : undefined;
  const contractConfig = environment.kind === "contract" ? environment.config : null;
  const contractMarketId =
    environment.kind === "contract" ? environment.marketId : null;
  const publicClient = usePublicClient({ chainId: contractChainId });
  const { data: walletClient } = useWalletClient({ chainId: contractChainId });
  const contractStatus = useContractMarketStatus({
    config: contractConfig,
    formatError: getReceiptPlacementErrorMessage,
    marketId: contractMarketId,
    publicClient,
    refreshKey: statusRefreshKey,
    walletAddress: wallet.address,
  });
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

  useEffect(
    () => subscribeToTestPusdMinted(() => setStatusRefreshKey((value) => value + 1)),
    []
  );

  function updateAmount(value: string) {
    setAmount(value.replace(/[^0-9.]/g, ""));
    setPlacedReceipt(null);
    setSubmitError(null);
  }

  function selectSide(value: string) {
    setSide(value === "no" ? "no" : "yes");
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

  async function handlePlaceReceipt() {
    /* v8 ignore next 3 -- defensive: the receipt action disables onClick whenever quote is null */
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

  return {
    amount,
    amountFieldError,
    balanceUsd,
    contractMarketMissing,
    contractStatus,
    environment,
    isPlacing,
    placedReceipt,
    placementStep,
    quote,
    receiptAction,
    side,
    submitError,
    walletConnected: Boolean(wallet.address),
    selectPresetAmount,
    selectSide,
    updateAmount,
  };
}
