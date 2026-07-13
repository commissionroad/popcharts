"use server";

import { revalidatePath } from "next/cache";

import {
  type DevMarketResolutionSide,
  requestDevMarketResolution,
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
