"use client";

import { useState } from "react";

import { presentError } from "@/lib/error-handling";

import { dispatchGeneratedMarketFill } from "./generated-market-events";
import { fetchGeneratedLocalMarket } from "./generated-market-service";

/** What the last fill attempt did, as the dev menu reports it back. */
export type GeneratedMarketFillResult =
  | {
      status: "error";
      message: string;
    }
  | {
      status: "success";
      message: string;
    };

/**
 * The button the dev menu renders: its label, whether it is clickable, and the
 * click itself when there is one. `onClick` is undefined exactly when the
 * action cannot run, so the menu never has to re-derive the reason.
 */
export type GeneratedMarketFillAction = {
  disabled: boolean;
  label: string;
  onClick: (() => void) | undefined;
};

/**
 * The dev menu's create-form autofill: generates one market from live public
 * sources and announces it for the create form to fill itself from. The form is
 * the only listener, so the action is offered only while it is on screen —
 * `createFormOpen` is the caller's read of the current route.
 */
export function useGeneratedMarketFill(createFormOpen: boolean): {
  action: GeneratedMarketFillAction;
  isGenerating: boolean;
  result: GeneratedMarketFillResult | null;
} {
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<GeneratedMarketFillResult | null>(null);

  async function runFill() {
    setIsGenerating(true);
    setResult(null);

    try {
      const market = await fetchGeneratedLocalMarket();

      dispatchGeneratedMarketFill(market);
      setResult({
        message: `Filled the form with a ${market.metadata.category} market.`,
        status: "success",
      });
    } catch (error) {
      setResult({
        message: presentError(error, {
          context: { operation: "generated-market-fill" },
          fallback: "The market generator could not fill the form.",
        }),
        status: "error",
      });
    } finally {
      setIsGenerating(false);
    }
  }

  return {
    action: getGeneratedMarketFillAction({
      createFormOpen,
      isGenerating,
      runFill,
    }),
    isGenerating,
    result,
  };
}

function getGeneratedMarketFillAction({
  createFormOpen,
  isGenerating,
  runFill,
}: {
  createFormOpen: boolean;
  isGenerating: boolean;
  runFill: () => void;
}): GeneratedMarketFillAction {
  if (isGenerating) {
    return { disabled: true, label: "Generating", onClick: undefined };
  }

  if (!createFormOpen) {
    return { disabled: true, label: "Random market", onClick: undefined };
  }

  return { disabled: false, label: "Random market", onClick: runFill };
}
