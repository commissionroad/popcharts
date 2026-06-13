import { calculateGraduationProgress } from "@/domain/graduation/clearing";
import { formatUsdCompact } from "@/lib/format";

export function GraduationBar({
  height = 8,
  matchedUsd,
  showCaption = true,
  targetUsd,
}: {
  height?: number;
  matchedUsd: number;
  showCaption?: boolean;
  targetUsd: number;
}) {
  const progress = calculateGraduationProgress({ matchedUsd, targetUsd });
  const color = progress.ready ? "var(--status-graduated)" : "var(--status-graduating)";

  return (
    <div>
      {showCaption ? (
        <div className="mb-2 flex items-baseline justify-between font-mono text-[11px]">
          <span className="tracking-[0.04em] text-[var(--text-muted)]">
            {progress.ready ? "READY TO GRADUATE" : "GRADUATION"}
          </span>
          <span style={{ color }}>
            {formatUsdCompact(matchedUsd)}{" "}
            <span className="text-[var(--text-muted)]">
              / {formatUsdCompact(targetUsd)} matched
            </span>
          </span>
        </div>
      ) : null}
      <div
        className="overflow-hidden rounded-[var(--radius-pill)] border border-[var(--border)] bg-[var(--surface-raised)]"
        style={{ height }}
      >
        <div
          className="h-full rounded-[var(--radius-pill)] transition-[width] duration-[var(--duration-normal)]"
          style={{
            background: color,
            boxShadow: progress.ready ? "var(--glow-lime)" : "var(--glow-amber)",
            width: `${progress.percent}%`,
          }}
        />
      </div>
    </div>
  );
}
