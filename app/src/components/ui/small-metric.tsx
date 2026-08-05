/** A compact labelled figure for stat rows: uppercase mono label over a bold
 * display value. Server- and client-renderable. */
export function SmallMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[10px] tracking-[0.1em] text-[var(--text-muted)] uppercase">
        {label}
      </div>
      <div className="font-display tabular mt-1 text-xl font-black">{value}</div>
    </div>
  );
}
