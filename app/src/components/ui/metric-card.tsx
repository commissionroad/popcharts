import type { ReactNode } from "react";

export function MetricCard({
  icon,
  label,
  tone = "var(--text-primary)",
  value,
}: {
  icon?: ReactNode;
  label: string;
  tone?: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3.5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-card)] p-4">
      {icon ? <div style={{ color: tone }}>{icon}</div> : null}
      <div>
        <div className="font-mono text-[10px] tracking-[0.08em] text-[var(--text-muted)] uppercase">
          {label}
        </div>
        <div
          className="font-display tabular mt-1 text-[22px] font-black"
          style={{ color: tone }}
        >
          {value}
        </div>
      </div>
    </div>
  );
}
