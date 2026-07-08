"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { usePublicClient, useWalletClient } from "wagmi";

import { type Market, type MarketSide, marketSideLabel } from "@/domain/markets/types";
import {
  getLimitPriceError,
  getLimitRestingError,
  getLimitSizeError,
  limitOrderDepositWad,
  limitOrderDirection,
  limitPriceCentsToWad,
  parseLimitPriceCents,
  type VenueOrderDirection,
} from "@/domain/postgrad-trading/limit-order";
import {
  parseVenueTradeAmount,
  poolPriceWadForSide,
  toVenueTokenUnits,
  venueTokenUnitsToNumber,
  type VenueTradeAction,
} from "@/domain/postgrad-trading/venue-trade";
import { useVenueBalances } from "@/integrations/contracts/hooks/use-venue-balances";
import { useWalletAccount } from "@/integrations/wallet/wallet-provider";

import { getLimitOrderAction, getLimitOrderErrorMessage } from "./limit-order-action";
import {
  placeVenueLimitOrder,
  type VenueLimitOrderReceipt,
  type VenueLimitOrderStep,
} from "./limit-order-service";
import {
  buildVenuePoolContext,
  resolveVenueTradingEnvironment,
  type VenuePoolContext,
  type VenueSwapWallet,
} from "./postgrad-swap-service";
import { getVenueSwapErrorMessage } from "./swap-action";

const BALANCE_EPSILON = 0.000001;

/**
 * A validated limit-order preview: the resting price, size, and the deposit
 * the order escrows (collateral for bids, outcome tokens for asks).
 */
export type LimitOrderQuote = {
  depositWad: bigint;
  direction: VenueOrderDirection;
  priceCents: number;
  sizeWad: bigint;
};

/**
 * The limit ticket's state machine: form state (side, buy/sell, whole-cent
 * price, size in outcome tokens), validation against the pool's current price
 * so only resting orders submit, the deposit preview, wallet balances, the
 * primary action decision, and the approve-and-create submission flow against
 * the order manager. Sibling of usePostgradTicketState — market orders and
 * maker orders share services but not state.
 */
export function useLimitOrderState(
  market: Market,
  { onOrderPlaced }: { onOrderPlaced?: () => void } = {}
) {
  const router = useRouter();
  const wallet = useWalletAccount();
  const [side, setSide] = useState<MarketSide>("yes");
  const [action, setAction] = useState<VenueTradeAction>("buy");
  const [priceInput, setPriceInput] = useState("");
  const [sizeInput, setSizeInput] = useState("100");
  const [isPlacing, setIsPlacing] = useState(false);
  const [orderStep, setOrderStep] = useState<VenueLimitOrderStep | null>(null);
  const [completedOrder, setCompletedOrder] = useState<VenueLimitOrderReceipt | null>(
    null
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
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
  const direction = limitOrderDirection(action);
  const priceCents = parseLimitPriceCents(priceInput);
  const priceError = getLimitPriceError(priceInput);
  const sizeError = getLimitSizeError(sizeInput);
  const numericSize = parseVenueTradeAmount(sizeInput);
  const sizeWad =
    sizeError === null && numericSize !== null ? toVenueTokenUnits(numericSize) : null;
  const poolPriceWad = poolPriceWadForSide(market, side);
  const restingError =
    priceCents !== null
      ? getLimitRestingError({
          direction,
          poolPriceWad,
          priceWad: limitPriceCentsToWad(priceCents),
        })
      : null;
  const quote: LimitOrderQuote | null =
    priceCents !== null && sizeWad !== null && restingError === null
      ? {
          depositWad: limitOrderDepositWad({
            direction,
            priceWad: limitPriceCentsToWad(priceCents),
            sizeWad,
          }),
          direction,
          priceCents,
          sizeWad,
        }
      : null;
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
    direction === "bid" ? collateralBalance : side === "yes" ? yesBalance : noBalance;
  const spendAmount = quote !== null ? venueTokenUnitsToNumber(quote.depositWad) : null;
  const insufficientBalance =
    contract !== null &&
    Boolean(wallet.address) &&
    spendBalance !== null &&
    spendAmount !== null &&
    spendAmount > spendBalance + BALANCE_EPSILON;
  const sideLabel = marketSideLabel(market, side);
  const spendLabel = direction === "bid" ? "pUSD" : `${sideLabel} tokens`;
  const insufficientBalanceMessage =
    insufficientBalance && spendAmount !== null && spendBalance !== null
      ? `This order deposits ${spendAmount.toLocaleString("en-US")} ${spendLabel}, but your wallet has ${spendBalance.toLocaleString("en-US")}.`
      : null;
  const priceFieldError = priceError ?? restingError ?? undefined;
  const sizeFieldError =
    sizeError ?? insufficientBalanceMessage ?? poolError ?? undefined;
  const placeAction = getLimitOrderAction({
    environment,
    fieldError: priceError ?? restingError ?? sizeError ?? poolError,
    insufficientBalance,
    isPlacing,
    onPlace: handlePlace,
    orderManagerConfigured: Boolean(contract?.venueConfig.orderManagerAddress),
    publicClientReady: Boolean(publicClient),
    sideLabel,
    spendLabel: direction === "bid" ? "pUSD" : "tokens",
    wallet,
    walletClientReady: Boolean(walletClient),
  });

  function updatePrice(value: string) {
    setPriceInput(value.replace(/[^0-9]/g, ""));
    setCompletedOrder(null);
    setSubmitError(null);
  }

  function updateSize(value: string) {
    setSizeInput(value.replace(/[^0-9.]/g, ""));
    setCompletedOrder(null);
    setSubmitError(null);
  }

  function selectSide(value: string) {
    setSide(value === "no" ? "no" : "yes");
    setCompletedOrder(null);
    setSubmitError(null);
  }

  function selectAction(value: string) {
    setAction(value === "sell" ? "sell" : "buy");
    setCompletedOrder(null);
    setSubmitError(null);
  }

  async function handlePlace() {
    /* v8 ignore next 3 -- defensive: the limit action disables onClick whenever these are missing */
    if (!contract || !pool || priceCents === null || sizeWad === null) {
      return;
    }

    setIsPlacing(true);
    setOrderStep(null);
    setCompletedOrder(null);
    setSubmitError(null);

    try {
      /* v8 ignore next 3 -- defensive: getLimitOrderAction only enables onPlace once the wallet address and both clients are present */
      if (!wallet.address || !publicClient || !walletClient) {
        throw new Error("Connect a wallet before trading.");
      }

      const orderWallet: VenueSwapWallet = {
        accountAddress: wallet.address as `0x${string}`,
        activeChainId: wallet.activeChainId,
        publicClient,
        walletClient,
      };
      const receipt = await placeVenueLimitOrder({
        direction,
        onStep: setOrderStep,
        pool,
        poolDisplayPriceWad: poolPriceWad,
        priceCents,
        side,
        sizeWad,
        venue: contract.venue,
        venueConfig: contract.venueConfig,
        wallet: orderWallet,
      });

      setCompletedOrder(receipt);
      setRefreshKey((value) => value + 1);
      onOrderPlaced?.();
      router.refresh();
    } catch (error) {
      setSubmitError(getLimitOrderErrorMessage(error));
    } finally {
      setIsPlacing(false);
      setOrderStep(null);
    }
  }

  return {
    action,
    balances: {
      collateral: collateralBalance,
      error: balances.error,
      loading: balances.loading,
      no: noBalance,
      yes: yesBalance,
    },
    completedOrder,
    environment,
    isPlacing,
    orderStep,
    placeAction,
    priceFieldError,
    priceInput,
    quote,
    side,
    sizeFieldError,
    sizeInput,
    submitError,
    walletConnected: Boolean(wallet.address),
    selectAction,
    selectSide,
    updatePrice,
    updateSize,
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
