"use client";

import { LoaderCircle, Rocket } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

import {
  graduateMarketAction,
  type GraduateMarketActionResult,
} from "./graduation-actions";

export function GraduateMarketButton({ marketId }: { marketId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<GraduateMarketActionResult | null>(null);

  return (
    <div className="mt-5 rounded-[var(--radius-md)] border border-[var(--status-graduated)] bg-[var(--surface-raised)] p-4">
      <Button
        className="w-full"
        disabled={isPending}
        leftIcon={
          isPending ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" size={18} />
          ) : (
            <Rocket aria-hidden="true" size={18} />
          )
        }
        onClick={() => {
          setResult(null);
          startTransition(async () => {
            const nextResult = await graduateMarketAction(marketId);

            setResult(nextResult);

            if (nextResult.status === "success") {
              router.refresh();
            }
          });
        }}
        size="lg"
      >
        {isPending ? "Graduating" : "Graduate market"}
      </Button>
      {result ? (
        <p
          className="mt-3 text-center font-mono text-[11px] leading-5"
          style={{
            color:
              result.status === "success" ? "var(--status-graduated)" : "var(--accent)",
          }}
        >
          {result.message}
        </p>
      ) : null}
    </div>
  );
}
