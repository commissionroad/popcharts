"use server";

import { revalidatePath } from "next/cache";

import { requestMarketGraduation } from "@/domain/markets/queries";

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
    await requestMarketGraduation(marketId);
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
