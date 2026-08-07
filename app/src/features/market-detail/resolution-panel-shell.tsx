import type { ReactNode } from "react";

/**
 * The bordered card every resolution state renders inside, tinted by the tone
 * of the state it carries. Lives in its own module so the settle surface and
 * the dispute surface can both use it without importing each other.
 */
export function ResolutionPanelShell({
  children,
  title,
  tone,
}: {
  children: ReactNode;
  title: string;
  /** A design-system colour variable, e.g. `var(--warning)`. */
  tone: string;
}) {
  return (
    <section
      className="rounded-[var(--radius-lg)] border bg-[var(--surface-card)] p-5"
      style={{ borderColor: tone }}
    >
      <div
        className="mb-3 font-mono text-[10px] tracking-[0.14em] uppercase"
        style={{ color: tone }}
      >
        {title}
      </div>
      {children}
    </section>
  );
}
