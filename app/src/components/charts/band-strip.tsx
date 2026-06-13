import { isBandMatched, overlapPriceBand } from "@/domain/graduation/clearing";
import type { PriceBand } from "@/domain/receipts/types";

const yesBands: PriceBand[] = [{ fromProbability: 20, toProbability: 70 }];
const noBands: PriceBand[] = [{ fromProbability: 90, toProbability: 40 }];

export function BandStrip() {
  const bands = Array.from({ length: 10 }, (_, index) => {
    const band = {
      fromProbability: index * 10,
      toProbability: (index + 1) * 10,
    };
    const matched = isBandMatched({ band, noBands, yesBands });
    const yesOnly =
      !matched && yesBands.some((yesBand) => overlapPriceBand(band, yesBand));
    const noOnly = !matched && noBands.some((noBand) => overlapPriceBand(band, noBand));

    return { band, matched, noOnly, yesOnly };
  });

  return (
    <div>
      <div className="flex overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border)]">
        {bands.map(({ band, matched, noOnly, yesOnly }) => {
          const background = matched
            ? "var(--status-graduated)"
            : yesOnly
              ? "var(--yes-wash)"
              : noOnly
                ? "var(--no-wash)"
                : "var(--surface-raised)";

          return (
            <div
              className="relative h-14 flex-1 border-r border-[var(--border)] last:border-r-0"
              key={band.fromProbability}
              style={{
                background,
                boxShadow: matched ? "inset 0 0 18px rgb(198 255 61 / 35%)" : "none",
              }}
            >
              <span
                className="absolute bottom-1 left-1 font-mono text-[9px]"
                style={{ color: matched ? "var(--pc-ink)" : "var(--text-muted)" }}
              >
                {band.fromProbability}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-4">
        <Legend color="var(--status-graduated)" label="Matched to complete sets" />
        <Legend color="var(--yes-wash)" label="YES only refunds" />
        <Legend color="var(--no-wash)" label="NO only refunds" />
        <Legend color="var(--surface-raised)" label="No demand" />
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-2 font-mono text-[11px] text-[var(--text-secondary)]">
      <span
        className="size-3 rounded border border-[var(--border)]"
        style={{ background: color }}
      />
      {label}
    </span>
  );
}
