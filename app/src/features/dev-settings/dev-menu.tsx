"use client";

import {
  CircleDollarSign,
  GraduationCap,
  LoaderCircle,
  Settings,
  XCircle,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  closePregradMarketAction,
  type ClosePregradMarketActionResult,
} from "@/features/market-detail/dev-market-actions";
import { forceGraduateMarketAction } from "@/features/market-detail/graduation-actions";
import { cn } from "@/lib/cn";

import { readRevealRawErrors, setRevealRawErrorsSetting } from "./dev-settings";
import { useTestPusdMint } from "./use-test-pusd-mint";

/**
 * Parses the market id out of a `/markets/:id` (or `/markets/:id/graduation`)
 * pathname. Ids are URL-encoded in links (they contain a colon), so decode.
 */
function marketIdFromPathname(pathname: string): string | null {
  const match = pathname.match(/^\/markets\/([^/]+)/);

  if (!match) {
    return null;
  }

  // Group 1 is guaranteed present when the match succeeds.
  const segment = match[1] as string;

  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * The app's dev-tools menu, mounted in the top bar (see `AppNav`). It is the
 * single home for dev overrides. All options are always shown; the
 * market-scoped actions act on whatever market you are currently viewing and
 * are disabled elsewhere. Only rendered when dev tools are enabled.
 */
export function DevMenu() {
  const router = useRouter();
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [revealErrors, setRevealErrors] = useState(() => readRevealRawErrors());
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<ClosePregradMarketActionResult | null>(null);
  const testPusdMint = useTestPusdMint();

  // Keep the flag `presentError` reads (and the persisted value) in step with
  // the toggle, including the initial hydrated value.
  useEffect(() => {
    setRevealRawErrorsSetting(revealErrors);
  }, [revealErrors]);

  const marketId = marketIdFromPathname(pathname);

  function runMarketAction(action: () => Promise<ClosePregradMarketActionResult>) {
    setResult(null);
    startTransition(async () => {
      const nextResult = await action();
      setResult(nextResult);

      if (nextResult.status === "success") {
        router.refresh();
      }
    });
  }

  return (
    <div className="relative">
      <button
        aria-expanded={isOpen}
        aria-label="Dev tools"
        className="focus-ring inline-flex size-9 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-card)] text-[var(--text-secondary)] transition-colors hover:border-[var(--pc-cyan)] hover:text-[var(--text-primary)]"
        onClick={() => setIsOpen((current) => !current)}
        title="Dev tools"
        type="button"
      >
        <Settings aria-hidden="true" size={17} />
      </button>

      {isOpen ? (
        <div className="fixed top-[58px] right-4 z-40 w-[min(300px,calc(100vw-2rem))] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-card)] p-3 shadow-[var(--shadow-tile)] sm:absolute sm:top-auto sm:right-0 sm:mt-2">
          <p className="px-2 pb-2 font-mono text-[11px] tracking-[0.1em] text-[var(--text-muted)] uppercase">
            Dev tools
          </p>

          <button
            aria-checked={revealErrors}
            className="focus-ring flex w-full items-center justify-between gap-4 rounded-[var(--radius-sm)] px-2 py-2 text-left"
            onClick={() => setRevealErrors((current) => !current)}
            role="switch"
            type="button"
          >
            <span>
              <span className="block font-mono text-[11px] tracking-[0.1em] text-[var(--text-primary)] uppercase">
                Reveal raw errors
              </span>
              <span className="mt-0.5 block text-[12px] text-[var(--text-muted)]">
                Show underlying error text inline instead of friendly copy
              </span>
            </span>
            <span
              className={cn(
                "relative h-6 w-11 shrink-0 rounded-[var(--radius-pill)] border transition-colors",
                revealErrors
                  ? "border-[var(--pc-cyan)] bg-[var(--pc-cyan-wash)]"
                  : "border-[var(--border-strong)] bg-[var(--surface-raised)]"
              )}
            >
              <span
                className={cn(
                  "absolute top-1/2 size-4 -translate-y-1/2 rounded-[var(--radius-pill)] bg-[var(--text-secondary)] transition-[left,background]",
                  revealErrors ? "left-[22px] bg-[var(--pc-cyan)]" : "left-1"
                )}
              />
            </span>
          </button>

          <div className="mt-3 border-t border-[var(--border-soft)] pt-3">
            <p className="px-2 pb-2 font-mono text-[11px] tracking-[0.1em] text-[var(--text-muted)] uppercase">
              Wallet
            </p>

            <Button
              className="w-full"
              disabled={testPusdMint.action.disabled}
              leftIcon={
                testPusdMint.isMinting ? (
                  <LoaderCircle aria-hidden="true" className="animate-spin" size={17} />
                ) : (
                  <CircleDollarSign aria-hidden="true" size={17} />
                )
              }
              onClick={testPusdMint.action.onClick}
              size="sm"
              variant="secondary"
            >
              {testPusdMint.action.label}
            </Button>

            {testPusdMint.result ? (
              <p
                className="mt-2 text-center font-mono text-[11px] leading-5"
                style={{
                  color:
                    testPusdMint.result.status === "success"
                      ? "var(--pc-cyan)"
                      : "var(--accent)",
                }}
              >
                {testPusdMint.result.message}
              </p>
            ) : null}
          </div>

          <div className="mt-3 border-t border-[var(--border-soft)] pt-3">
            <p className="px-2 pb-2 font-mono text-[11px] tracking-[0.1em] text-[var(--text-muted)] uppercase">
              Current market
            </p>

            <Button
              className="w-full"
              disabled={isPending || marketId === null}
              leftIcon={
                isPending ? (
                  <LoaderCircle aria-hidden="true" className="animate-spin" size={17} />
                ) : (
                  <GraduationCap aria-hidden="true" size={17} />
                )
              }
              onClick={
                marketId !== null
                  ? () => runMarketAction(() => forceGraduateMarketAction(marketId))
                  : undefined
              }
              size="sm"
              variant="secondary"
            >
              {isPending ? "Working" : "Force graduate"}
            </Button>

            <Button
              className="mt-2 w-full border-[var(--danger)] text-[var(--text-primary)] hover:border-[var(--danger)]"
              disabled={isPending || marketId === null}
              leftIcon={
                isPending ? (
                  <LoaderCircle aria-hidden="true" className="animate-spin" size={17} />
                ) : (
                  <XCircle aria-hidden="true" size={17} />
                )
              }
              onClick={
                marketId !== null
                  ? () => runMarketAction(() => closePregradMarketAction(marketId))
                  : undefined
              }
              size="sm"
              variant="secondary"
            >
              {isPending ? "Working" : "Close for refunds"}
            </Button>

            {marketId === null ? (
              <p className="mt-2 px-2 text-[11px] leading-4 text-[var(--text-muted)]">
                Open a market to use these.
              </p>
            ) : null}
          </div>

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
