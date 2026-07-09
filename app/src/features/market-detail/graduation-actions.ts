"use server";

import { revalidatePath } from "next/cache";

import {
  requestDevMarketGraduation,
  requestMarketGraduation,
} from "@/domain/markets/queries";
import { presentError } from "@/lib/error-handling";

export type GraduateMarketActionResult =
  | {
      status: "error";
      message: string;
    }
  | {
      status: "success";
      message: string;
    };

/**
 * Dev-tools force graduation: mints local collateral and places receipts
 * until the market covers its threshold, then settles it end to end. Only
 * reachable from the dev settings menu.
 */
export async function forceGraduateMarketAction(
  marketId: string
): Promise<GraduateMarketActionResult> {
  try {
    await requestDevMarketGraduation(marketId, { force: true });
    revalidatePath("/");
    revalidatePath(`/markets/${marketId}`);
    revalidatePath(`/markets/${marketId}/graduation`);

    return {
      message: "Forced graduation settled onchain.",
      status: "success",
    };
  } catch (error) {
    return {
      message: presentError(error, {
        context: { marketId, operation: "force-graduate-market" },
        fallback: "Could not graduate this market.",
      }),
      status: "error",
    };
  }
}

export async function graduateMarketAction(
  marketId: string
): Promise<GraduateMarketActionResult> {
  try {
    // With dev tools enabled the server runs the whole onchain settlement
    // (top-up, clearing root, challenge window, postgrad handoff); otherwise
    // the read-only endpoint only reports markets the chain already settled.
    if (devToolsEnabled()) {
      await requestDevMarketGraduation(marketId);
    } else {
      await requestMarketGraduation(marketId);
    }
    revalidatePath("/");
    revalidatePath(`/markets/${marketId}`);
    revalidatePath(`/markets/${marketId}/graduation`);

    return {
      message: "Graduation finalized onchain. Trading is closed.",
      status: "success",
    };
  } catch (error) {
    return {
      message: presentError(error, {
        context: { marketId, operation: "graduate-market" },
        fallback: "Could not graduate this market.",
      }),
      status: "error",
    };
  }
}

function devToolsEnabled() {
  return process.env.NEXT_PUBLIC_POPCHARTS_DEV_TOOLS_ENABLED === "true";
}
