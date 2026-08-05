"use client";

import { ArrowRight, Layers } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { getMarkets } from "@/domain/markets/queries";
import type { Market } from "@/domain/markets/types";
import { parseApiMarketAppId } from "@/lib/app-id";

/**
 * The "start from a market" surface: pick any live market from the board (or
 * paste its id) and clone it into a fresh editing draft. Cloning copies the
 * content verbatim (ADR 0022 §9) — deadline windows come from the source
 * market's own spans.
 */
export function CloneMarketBox({
  onClone,
  onClosed,
}: {
  onClone: (chainId: number, marketId: string) => Promise<boolean>;
  onClosed: () => void;
}) {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [marketsLoaded, setMarketsLoaded] = useState(false);
  const [pastedId, setPastedId] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [cloningId, setCloningId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void getMarkets()
      .then((loaded) => {
        if (!cancelled) {
          setMarkets(loaded.slice(0, 8));
        }
      })
      .catch(() => {
        // The paste path still works when the board can't load.
      })
      .finally(() => {
        if (!cancelled) {
          setMarketsLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function cloneAppId(appId: string) {
    const parsed = parseApiMarketAppId(appId.trim());

    if (!parsed) {
      setPasteError("Use the market id format chainId:marketId, e.g. 31337:4.");
      return;
    }

    setPasteError(null);
    setCloningId(appId.trim());

    const cloned = await onClone(parsed.chainId, parsed.marketId);

    setCloningId(null);

    if (cloned) {
      onClosed();
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--pc-cyan)] bg-[var(--surface-card)] p-5">
      <div className="flex items-center gap-2">
        <Layers color="var(--pc-cyan)" size={16} />
        <span className="font-mono text-[11px] font-bold tracking-[0.14em] text-[var(--pc-cyan)] uppercase">
          Start from a market
        </span>
      </div>

      {markets.length > 0 ? (
        <ul className="flex flex-col divide-y divide-[var(--border-soft)]">
          {markets.map((market) => (
            <li
              className="flex items-center justify-between gap-3 py-2.5"
              key={market.id}
            >
              <span className="line-clamp-1 text-[13px] text-[var(--text-secondary)]">
                {market.question}
              </span>
              <button
                className="focus-ring inline-flex shrink-0 items-center gap-1 font-mono text-[11px] text-[var(--pc-cyan)] hover:text-[var(--text-primary)]"
                disabled={cloningId !== null}
                onClick={() => void cloneAppId(market.id)}
                type="button"
              >
                {cloningId === market.id ? "Cloning…" : "Clone"}
                <ArrowRight size={12} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12.5px] text-[var(--text-muted)]">
          {marketsLoaded
            ? "No markets on the board yet — paste a market id instead."
            : "Loading the board…"}
        </p>
      )}

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void cloneAppId(pastedId);
        }}
      >
        <input
          aria-label="Market id to clone"
          className="focus-ring min-w-0 flex-1 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 font-mono text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
          onChange={(event) => {
            setPastedId(event.target.value);
            setPasteError(null);
          }}
          placeholder="Paste a market id, e.g. 31337:4"
          value={pastedId}
        />
        <Button
          disabled={!pastedId.trim() || cloningId !== null}
          size="sm"
          type="submit"
        >
          Clone
        </Button>
      </form>
      {pasteError ? (
        <p className="text-[12px] text-[var(--no)]" role="alert">
          {pasteError}
        </p>
      ) : null}
    </div>
  );
}
