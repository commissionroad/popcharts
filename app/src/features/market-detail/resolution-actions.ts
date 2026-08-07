"use server";

import type { ResolutionFinalizeRefusedStatus } from "@popcharts/api-client/models";
import { revalidatePath } from "next/cache";

import {
  type DevMarketResolutionSide,
  requestDevMarketResolution,
  requestMarketResolutionFinalization,
} from "@/domain/markets/queries";
import { presentError } from "@/lib/error-handling";

export type ResolveMarketActionResult =
  | {
      status: "error";
      message: string;
    }
  | {
      status: "success";
      message: string;
    };

/**
 * What {@link settleMarketAction} answered. `refused` carries the endpoint's
 * own reason rather than a message so the panel owns the copy a person reads —
 * the API's wording is written for a client, not for a market page.
 */
export type SettleMarketActionResult =
  | { status: "error"; message: string }
  | { status: "refused"; reason: ResolutionFinalizeRefusedStatus }
  | { status: "settled" };

/**
 * Dev-tools force resolution: selects a YES or NO winner for a graduated
 * local postgrad market. Only reachable from the dev settings menu.
 */
export async function forceResolveMarketAction(
  marketId: string,
  side: DevMarketResolutionSide
): Promise<ResolveMarketActionResult> {
  try {
    await requestDevMarketResolution(marketId, side);
    revalidatePath("/");
    revalidatePath(`/markets/${marketId}`);
    revalidatePath(`/markets/${marketId}/graduation`);

    return {
      message: `Resolved ${side.toUpperCase()} onchain.`,
      status: "success",
    };
  } catch (error) {
    return {
      message: presentError(error, {
        context: { marketId, operation: "force-resolve-market", side },
        fallback: "Could not resolve this market.",
      }),
      status: "error",
    };
  }
}

/**
 * Settles a graduated market whose dispute window has closed, on behalf of any
 * viewer looking at it (repo ADR 0024). This is a public failsafe, not an
 * operator tool: `finalizeResolution()` is permissionless and takes no
 * payment, so the caller signs nothing, pays nothing, and gains nothing — the
 * outcome settled is the one already proposed on chain.
 *
 * A server action rather than a browser call because the indexer API is a
 * different origin from the app and only the server holds its URL.
 *
 * A refusal comes back as a result rather than an error. The keeper or another
 * viewer settling first is the expected case, not a fault, and the panel says
 * so in plain copy.
 */
export async function settleMarketAction(
  marketId: string
): Promise<SettleMarketActionResult> {
  try {
    const result = await requestMarketResolutionFinalization(marketId);

    if (result.status !== "settled") {
      return { reason: result.status, status: "refused" };
    }

    revalidatePath("/");
    revalidatePath(`/markets/${marketId}`);

    return { status: "settled" };
  } catch (error) {
    return {
      message: presentError(error, {
        context: { marketId, operation: "settle-market" },
        fallback: "Could not settle this market.",
      }),
      status: "error",
    };
  }
}
