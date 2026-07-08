"use client";

import type { VenueOrder } from "@popcharts/api-client/models";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { usePublicClient, useWalletClient } from "wagmi";

import {
  type Market,
  marketSideLabel,
  type MarketVenueInfo,
} from "@/domain/markets/types";
import {
  isVenueOrderCrossed,
  wadPriceToCents,
} from "@/domain/postgrad-trading/limit-order";
import { venueTokenUnitsToNumber } from "@/domain/postgrad-trading/venue-trade";
import { useWalletAccount } from "@/integrations/wallet/wallet-provider";
import { parseApiMarketAppId } from "@/lib/app-id";
import { DisplayableError } from "@/lib/error-handling";

import { getLimitOrderErrorMessage } from "./limit-order-action";
import {
  cancelVenueLimitOrder,
  type VenueCancelOrderStep,
} from "./limit-order-service";
import {
  buildVenuePoolContext,
  resolveVenueTradingEnvironment,
  type VenueSwapWallet,
} from "./postgrad-swap-service";
import { useOpenVenueOrders } from "./use-open-venue-orders";

/** One open maker order prepared for display in the panel. */
export type OpenOrderRow = {
  cancelling: boolean;
  /**
   * True when the pool price has crossed the order (or it is partially
   * filled), so fills are due but may land with the keeper a few seconds
   * later.
   */
  filling: boolean;
  key: string;
  order: VenueOrder;
  priceCents: number;
  remainingSize: number;
  sideLabel: string;
  size: number;
};

/**
 * State for the open-orders panel: the polled order list mapped to display
 * rows with crossed-order detection, and the per-row cancel flow against the
 * order manager. The panel shows only when the venue is live on-chain and a
 * wallet is connected; fixture-backed venues have no book to read.
 */
export function useOpenOrdersPanelState(
  market: Market,
  { refreshKey }: { refreshKey: number }
) {
  const router = useRouter();
  const wallet = useWalletAccount();
  const environment = useMemo(() => resolveVenueTradingEnvironment(market), [market]);
  const contract = environment.kind === "contract" ? environment : null;
  const publicClient = usePublicClient({
    chainId: contract?.config.chainId,
  });
  const { data: walletClient } = useWalletClient({
    chainId: contract?.config.chainId,
  });
  const lookup = useMemo(() => parseApiMarketAppId(market.id), [market.id]);
  const enabled = contract !== null && Boolean(wallet.address) && lookup !== null;
  const ordersState = useOpenVenueOrders({
    chainId: enabled ? lookup.chainId : null,
    marketId: enabled ? lookup.marketId : null,
    owner: enabled ? wallet.address : null,
    refreshKey,
  });
  const [cancellingKey, setCancellingKey] = useState<string | null>(null);
  const [cancelStep, setCancelStep] = useState<VenueCancelOrderStep | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const rows: OpenOrderRow[] = (ordersState.orders ?? []).map((order) => {
    const key = `${order.poolId.toLowerCase()}:${order.orderId}`;
    const poolPriceWad = poolPriceWadForOrder({
      order,
      poolPricesWad: ordersState.poolPricesWad,
      venue: contract?.venue ?? null,
    });

    return {
      cancelling: cancellingKey === key,
      filling:
        BigInt(order.remainingSizeWad) < BigInt(order.sizeWad) ||
        (poolPriceWad !== null &&
          isVenueOrderCrossed({
            direction: order.direction,
            poolPriceWad,
            priceWad: BigInt(order.priceWad),
          })),
      key,
      order,
      priceCents: wadPriceToCents(BigInt(order.priceWad)),
      remainingSize: venueTokenUnitsToNumber(BigInt(order.remainingSizeWad)),
      sideLabel: marketSideLabel(market, order.side),
      size: venueTokenUnitsToNumber(BigInt(order.sizeWad)),
    };
  });

  async function cancelOrder(row: OpenOrderRow) {
    /* v8 ignore next 3 -- defensive: the panel only renders rows for the contract environment */
    if (!contract) {
      return;
    }

    setCancellingKey(row.key);
    setCancelStep(null);
    setCancelError(null);

    try {
      if (!wallet.address || !publicClient || !walletClient) {
        throw new DisplayableError("Connect a wallet before cancelling orders.");
      }

      const cancelWallet: VenueSwapWallet = {
        accountAddress: wallet.address as `0x${string}`,
        activeChainId: wallet.activeChainId,
        publicClient,
        walletClient,
      };
      const pool = buildVenuePoolContext({
        collateral: contract.config.collateralAddress,
        side: row.order.side,
        venue: contract.venue,
      });

      await cancelVenueLimitOrder({
        onStep: setCancelStep,
        orderId: row.order.orderId,
        pool,
        venue: contract.venue,
        venueConfig: contract.venueConfig,
        wallet: cancelWallet,
      });

      ordersState.refresh();
      router.refresh();
    } catch (error) {
      setCancelError(getLimitOrderErrorMessage(error));
    } finally {
      setCancellingKey(null);
      setCancelStep(null);
    }
  }

  return {
    cancelError,
    cancelStep,
    error: ordersState.error,
    loading: ordersState.loading,
    ordersLoaded: ordersState.orders !== null,
    rows,
    visible: enabled,
    cancelOrder,
  };
}

/**
 * The freshest display price for an order's pool: the price the orders poll
 * saw, falling back to the indexed venue payload. Null when neither source
 * knows the pool yet.
 */
function poolPriceWadForOrder({
  order,
  poolPricesWad,
  venue,
}: {
  order: VenueOrder;
  poolPricesWad: Readonly<Record<string, string>>;
  venue: MarketVenueInfo | null;
}): bigint | null {
  const polled = poolPricesWad[order.poolId.toLowerCase()];

  if (polled) {
    return BigInt(polled);
  }

  const venuePool = order.side === "yes" ? venue?.yesPool : venue?.noPool;

  if (
    venuePool &&
    venuePool.poolId.toLowerCase() === order.poolId.toLowerCase() &&
    venuePool.displayPriceWad
  ) {
    return BigInt(venuePool.displayPriceWad);
  }

  return null;
}
