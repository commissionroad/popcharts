"use server";

import { revalidatePath } from "next/cache";

import { requestPregradMarketCloseForRefund } from "@/domain/markets/queries";
import { presentError } from "@/lib/error-handling";

export type ClosePregradMarketActionResult =
  | {
      status: "error";
      message: string;
    }
  | {
      status: "success";
      message: string;
    };

export async function closePregradMarketAction(
  marketId: string
): Promise<ClosePregradMarketActionResult> {
  try {
    await requestPregradMarketCloseForRefund(marketId);
    revalidatePath("/");
    revalidatePath(`/markets/${marketId}`);

    return {
      message: "Closed for refunds.",
      status: "success",
    };
  } catch (error) {
    return {
      message: presentError(error, {
        context: { marketId, operation: "close-pregrad-market" },
        fallback: "Could not close this market for refunds.",
      }),
      status: "error",
    };
  }
}
