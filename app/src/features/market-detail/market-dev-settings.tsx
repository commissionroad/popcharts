"use client";

import { LoaderCircle, Settings, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

import {
  closePregradMarketAction,
  type ClosePregradMarketActionResult,
} from "./dev-market-actions";

export function MarketDevSettings({
  canClosePregrad,
  marketId,
}: {
  canClosePregrad: boolean;
  marketId: string;
}) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [devSettingsEnabled, setDevSettingsEnabled] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<ClosePregradMarketActionResult | null>(null);

  return (
    <div className="relative">
      <button
        aria-expanded={isOpen}
        aria-label="Market settings"
        className="focus-ring inline-flex size-9 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-card)] text-[var(--text-secondary)] transition-colors hover:border-[var(--pc-cyan)] hover:text-[var(--text-primary)]"
        onClick={() => setIsOpen((current) => !current)}
        title="Market settings"
        type="button"
      >
        <Settings aria-hidden="true" size={17} />
      </button>

      {isOpen ? (
        <div className="absolute right-0 z-20 mt-2 w-[min(280px,calc(100vw-2rem))] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-card)] p-3 shadow-[var(--shadow-tile)]">
          <button
            aria-checked={devSettingsEnabled}
            className="focus-ring flex w-full items-center justify-between gap-4 rounded-[var(--radius-sm)] px-2 py-2 text-left"
            onClick={() => {
              setDevSettingsEnabled((current) => !current);
              setResult(null);
            }}
            role="switch"
            type="button"
          >
            <span>
              <span className="block font-mono text-[11px] tracking-[0.1em] text-[var(--text-primary)] uppercase">
                Dev settings
              </span>
              <span className="mt-0.5 block text-[12px] text-[var(--text-muted)]">
                Local market tools
              </span>
            </span>
            <span
              className={cn(
                "relative h-6 w-11 rounded-[var(--radius-pill)] border transition-colors",
                devSettingsEnabled
                  ? "border-[var(--pc-cyan)] bg-[var(--pc-cyan-wash)]"
                  : "border-[var(--border-strong)] bg-[var(--surface-raised)]"
              )}
            >
              <span
                className={cn(
                  "absolute top-1/2 size-4 -translate-y-1/2 rounded-[var(--radius-pill)] bg-[var(--text-secondary)] transition-[left,background]",
                  devSettingsEnabled ? "left-[22px] bg-[var(--pc-cyan)]" : "left-1"
                )}
              />
            </span>
          </button>

          {devSettingsEnabled && canClosePregrad ? (
            <div className="mt-3 border-t border-[var(--border-soft)] pt-3">
              <Button
                className="w-full border-[var(--danger)] text-[var(--text-primary)] hover:border-[var(--danger)]"
                disabled={isPending}
                leftIcon={
                  isPending ? (
                    <LoaderCircle
                      aria-hidden="true"
                      className="animate-spin"
                      size={17}
                    />
                  ) : (
                    <XCircle aria-hidden="true" size={17} />
                  )
                }
                onClick={() => {
                  setResult(null);
                  startTransition(async () => {
                    const nextResult = await closePregradMarketAction(marketId);

                    setResult(nextResult);

                    if (nextResult.status === "success") {
                      router.refresh();
                    }
                  });
                }}
                size="sm"
                variant="secondary"
              >
                {isPending ? "Closing" : "Close for refunds"}
              </Button>
            </div>
          ) : null}

          {result ? (
            <p
              className="mt-3 text-center font-mono text-[11px] leading-5"
              style={{
                color:
                  result.status === "success"
                    ? "var(--status-refunded)"
                    : "var(--accent)",
              }}
            >
              {result.message}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
