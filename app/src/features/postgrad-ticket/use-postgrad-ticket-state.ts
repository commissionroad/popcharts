"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { usePublicClient, useWalletClient } from "wagmi";

import { type Market, type MarketSide, marketSideLabel } from "@/domain/markets/types";
import {
  buildVenueSwapQuote,
  estimateVenueSwapOutput,
  getVenueTradeAmountError,
  MAX_VENUE_TRADE_AMOUNT,
  parseVenueTradeAmount,
  poolPriceWadForSide,
  toVenueTokenUnits,
  type VenueSwapQuote,
  venueTokenUnitsToNumber,
  type VenueTradeAction,
} from "@/domain/postgrad-trading/venue-trade";
import { subscribeToTestPusdMinted } from "@/features/dev-settings/test-pusd-events";
import { formatPresetAmount } from "@/features/receipt-ticket/receipt-ticket-format";
import { useVenueBalances } from "@/integrations/contracts/hooks/use-venue-balances";
import { useWalletAccount } from "@/integrations/wallet/wallet-provider";

import {
  buildVenuePoolContext,
  placeVenueSwap,
  quoteVenueSwap,
  resolveVenueTradingEnvironment,
  type VenuePoolContext,
  type VenueSwapReceipt,
  type VenueSwapStep,
  type VenueSwapWallet,
} from "./postgrad-swap-service";
import {
  getMaxVenueTradeAmount,
  getVenueSwapAction,
  getVenueSwapErrorMessage,
  isPriceBoundError,
  PRICE_BOUND_QUOTE_WARNING,
} from "./swap-action";

export const venuePresetAmounts = ["50", "250", "1000", "Max"] as const;
const BALANCE_EPSILON = 0.000001;

type QuoterReadState = {
  amountOut: bigint | null;
  boundLimited: boolean;
  error: string | null;
  requestKey: string | null;
};

/**
 * The postgrad ticket's state machine: form state (side, buy/sell, amount),
 * the live quote (v4 quoter when deployed, pool-price estimate otherwise),
 * wallet balances for collateral and both outcome tokens, the primary swap
 * action, and the approve-and-swap submission flow against the resolved venue
 * environment. Returns state plus actions so the PostgradTicket component
 * stays purely presentational.
 */
export function usePostgradTicketState(market: Market) {
  const router = useRouter();
  const wallet = useWalletAccount();
  const [amount, setAmount] = useState("250");
  const [side, setSide] = useState<MarketSide>("yes");
  const [action, setAction] = useState<VenueTradeAction>("buy");
  const [isSwapping, setIsSwapping] = useState(false);
  const [swapStep, setSwapStep] = useState<VenueSwapStep | null>(null);
  const [completedSwap, setCompletedSwap] = useState<VenueSwapReceipt | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [quoterState, setQuoterState] = useState<QuoterReadState>({
    amountOut: null,
    boundLimited: false,
    error: null,
    requestKey: null,
  });
  const environment = useMemo(() => resolveVenueTradingEnvironment(market), [market]);
  const contract = environment.kind === "contract" ? environment : null;
  const publicClient = usePublicClient({
    chainId: contract?.config.chainId,
  });
  const { data: walletClient } = useWalletClient({
    chainId: contract?.config.chainId,
  });
  const { pool, poolError } = useMemo(
    () => resolvePool(contract, side),
    [contract, side]
  );
  const amountError = getVenueTradeAmountError(amount, action);
  const numericAmount = parseVenueTradeAmount(amount);
  const amountIn =
    amountError === null && numericAmount !== null
      ? toVenueTokenUnits(numericAmount)
      : null;
  const poolPriceWad = poolPriceWadForSide(market, side);
  const quoterRequestKey =
    contract && pool && amountIn !== null && publicClient
      ? [pool.poolId, action, amountIn.toString(), refreshKey].join(":")
      : null;

  useEffect(() => {
    let isActive = true;

    if (!quoterRequestKey || !contract || !pool || amountIn === null || !publicClient) {
      return;
    }

    quoteVenueSwap({
      action,
      amountIn,
      pool,
      publicClient,
      venueConfig: contract.venueConfig,
    })
      .then((amountOut) => {
        if (isActive) {
          setQuoterState({
            amountOut,
            boundLimited: false,
            error: null,
            requestKey: quoterRequestKey,
          });
        }
      })
      .catch((error: unknown) => {
        if (!isActive) {
          return;
        }

        // The quoter simulates without the band-edge price limit the real
        // swap uses, so a PoolTickOutOfBounds revert means "bigger than the
        // band can fill", not "cannot trade": fall back to the pool-price
        // estimate and warn instead of blocking.
        setQuoterState(
          isPriceBoundError(error)
            ? {
                amountOut: null,
                boundLimited: true,
                error: null,
                requestKey: quoterRequestKey,
              }
            : {
                amountOut: null,
                boundLimited: false,
                error: getVenueSwapErrorMessage(error),
                requestKey: quoterRequestKey,
              }
        );
      });

    return () => {
      isActive = false;
    };
  }, [action, amountIn, contract, pool, publicClient, quoterRequestKey]);

  const quoterRead =
    quoterRequestKey !== null && quoterState.requestKey === quoterRequestKey
      ? quoterState
      : null;
  const quoteError = quoterRead?.error ?? null;
  const quoteWarning = quoterRead?.boundLimited ? PRICE_BOUND_QUOTE_WARNING : null;
  const quoterAmountOut = quoterRead?.amountOut ?? null;
  const quote: VenueSwapQuote | null =
    amountIn === null || quoteError !== null
      ? null
      : buildVenueSwapQuote({
          action,
          amountIn,
          amountOut:
            quoterAmountOut ??
            estimateVenueSwapOutput({ action, amountIn, poolPriceWad }),
          poolPriceWad,
          side,
          source: quoterAmountOut !== null ? "quoter" : "estimate",
        });
  const quoteLoading = quoterRequestKey !== null && quoterRead === null;
  const balances = useVenueBalances({
    collateralAddress: contract?.config.collateralAddress ?? null,
    formatError: getVenueSwapErrorMessage,
    noTokenAddress: contract
      ? (contract.venue.noPool.outcomeTokenAddress as `0x${string}`)
      : null,
    publicClient,
    refreshKey,
    walletAddress: wallet.address,
    yesTokenAddress: contract
      ? (contract.venue.yesPool.outcomeTokenAddress as `0x${string}`)
      : null,
  });
  const collateralBalance = toBalanceNumber(balances.collateral);
  const yesBalance = toBalanceNumber(balances.yes);
  const noBalance = toBalanceNumber(balances.no);
  const spendBalance =
    action === "buy" ? collateralBalance : side === "yes" ? yesBalance : noBalance;
  const insufficientBalance =
    contract !== null &&
    Boolean(wallet.address) &&
    spendBalance !== null &&
    numericAmount !== null &&
    numericAmount > spendBalance + BALANCE_EPSILON;
  const sideLabel = marketSideLabel(market, side);
  const insufficientBalanceMessage =
    insufficientBalance && numericAmount !== null && spendBalance !== null
      ? `This order spends ${numericAmount.toLocaleString("en-US")} ${
          action === "buy" ? "pUSD" : `${sideLabel} tokens`
        }, but your wallet has ${spendBalance.toLocaleString("en-US")}.`
      : null;
  const amountFieldError =
    amountError ?? insufficientBalanceMessage ?? quoteError ?? poolError ?? undefined;
  const swapAction = getVenueSwapAction({
    action,
    amountError: amountError ?? quoteError ?? poolError,
    environment,
    insufficientBalance,
    isSwapping,
    onSwap: handleSwap,
    publicClientReady: Boolean(publicClient),
    quote,
    sideLabel,
    wallet,
    walletClientReady: Boolean(walletClient),
  });

  useEffect(
    () => subscribeToTestPusdMinted(() => setRefreshKey((value) => value + 1)),
    []
  );

  function updateAmount(value: string) {
    setAmount(value.replace(/[^0-9.]/g, ""));
    setCompletedSwap(null);
    setSubmitError(null);
  }

  function selectSide(value: string) {
    setSide(value === "no" ? "no" : "yes");
    setCompletedSwap(null);
    setSubmitError(null);
  }

  function selectAction(value: string) {
    setAction(value === "sell" ? "sell" : "buy");
    setCompletedSwap(null);
    setSubmitError(null);
  }

  function selectPresetAmount(preset: (typeof venuePresetAmounts)[number]) {
    if (preset !== "Max") {
      updateAmount(preset);
      return;
    }

    updateAmount(
      formatPresetAmount(
        getMaxVenueTradeAmount({
          balance: spendBalance,
          maxAmount: MAX_VENUE_TRADE_AMOUNT,
        })
      )
    );
  }

  async function handleSwap() {
    /* v8 ignore next 3 -- defensive: the swap action disables onClick whenever these are missing */
    if (!contract || !pool || amountIn === null) {
      return;
    }

    setIsSwapping(true);
    setSwapStep(null);
    setCompletedSwap(null);
    setSubmitError(null);

    try {
      /* v8 ignore next 3 -- defensive: getVenueSwapAction only enables onSwap once the wallet address and both clients are present */
      if (!wallet.address || !publicClient || !walletClient) {
        throw new Error("Connect a wallet before trading.");
      }

      const swapWallet: VenueSwapWallet = {
        accountAddress: wallet.address as `0x${string}`,
        activeChainId: wallet.activeChainId,
        publicClient,
        walletClient,
      };
      const receipt = await placeVenueSwap({
        action,
        amountIn,
        onStep: setSwapStep,
        pool,
        side,
        venueConfig: contract.venueConfig,
        wallet: swapWallet,
      });

      setCompletedSwap(receipt);
      setRefreshKey((value) => value + 1);
      router.refresh();
      window.setTimeout(() => router.refresh(), 1_500);
      window.setTimeout(() => router.refresh(), 4_000);
    } catch (error) {
      setSubmitError(getVenueSwapErrorMessage(error));
    } finally {
      setIsSwapping(false);
      setSwapStep(null);
    }
  }

  return {
    action,
    amount,
    amountFieldError,
    balances: {
      collateral: collateralBalance,
      error: balances.error,
      loading: balances.loading,
      no: noBalance,
      yes: yesBalance,
    },
    completedSwap,
    environment,
    isSwapping,
    quote,
    quoteLoading,
    quoteWarning,
    side,
    submitError,
    swapAction,
    swapStep,
    walletConnected: Boolean(wallet.address),
    selectAction,
    selectPresetAmount,
    selectSide,
    updateAmount,
  };
}

function resolvePool(
  contract: Extract<
    ReturnType<typeof resolveVenueTradingEnvironment>,
    { kind: "contract" }
  > | null,
  side: MarketSide
): { pool: VenuePoolContext | null; poolError: string | null } {
  if (!contract) {
    return { pool: null, poolError: null };
  }

  try {
    return {
      pool: buildVenuePoolContext({
        collateral: contract.config.collateralAddress,
        side,
        venue: contract.venue,
      }),
      poolError: null,
    };
  } catch (error) {
    return { pool: null, poolError: getVenueSwapErrorMessage(error) };
  }
}

function toBalanceNumber(value: bigint | null) {
  return value === null ? null : venueTokenUnitsToNumber(value);
}
