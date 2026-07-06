"use server";

import { revalidatePath } from "next/cache";

import {
  requestDevMarketGraduation,
  requestMarketGraduation,
} from "@/domain/markets/queries";

export type GraduateMarketActionResult =
  | {
      status: "error";
      message: string;
    }
  | {
      status: "success";
      message: string;
    };

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
      message:
        error instanceof Error ? error.message : "Could not graduate this market.",
      status: "error",
    };
  }
}

function devToolsEnabled() {
  return process.env.NEXT_PUBLIC_POPCHARTS_DEV_TOOLS_ENABLED === "true";
}
