"use server";

import { revalidatePath } from "next/cache";

import { requestPregradMarketCloseForRefund } from "@/domain/markets/queries";

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
      message:
        error instanceof Error
          ? error.message
          : "Could not close this market for refunds.",
      status: "error",
    };
  }
}
