/**
 * Append-only JSONL helpers for the ci-metrics datastore (ADR 0017): one JSON
 * object per line. Shared by the coverage and nightly trend logs so both treat
 * a malformed line the same way — a lost data point, never a lost report.
 */

/** Appends one row as a JSON line, normalising the trailing newline first. */
export function appendJsonl(existing: string | null, row: unknown): string {
  const base =
    existing && existing.length > 0 ? existing.replace(/\n?$/, "\n") : "";
  return `${base}${JSON.stringify(row)}\n`;
}

/** Parses JSONL into rows, skipping (not throwing on) any malformed line. */
export function parseJsonl<T>(text: string | null): T[] {
  if (!text) return [];
  const rows: T[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed) as T);
    } catch {
      // A malformed row loses one data point, never the whole report.
    }
  }
  return rows;
}
