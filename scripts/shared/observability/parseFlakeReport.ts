/**
 * Parses the weekly `FLAKES.md` the flake-report job writes to ci-metrics
 * (ADR 0017 Track A). That report is markdown rather than JSON, so the
 * dashboard reads it back out of the rendered table instead of a datastore —
 * a malformed row is skipped, never fatal.
 */
export interface FlakeRow {
  workflow: string;
  runs: number;
  failures: number;
  failurePct: number | null;
  rerunPasses: number;
  flakePct: number | null;
  overThreshold: boolean;
}

export interface FlakeReport {
  /** The report's own window and generation time, for freshness. */
  window: { from: string; to: string; generatedAt: string } | null;
  rows: FlakeRow[];
}

/** `Window <from> → <to>; generated <ts>.` — the report's provenance line. */
const WINDOW = /^Window\s+(\S+)\s+→\s+(\S+);\s+generated\s+(\S+?)\.?$/m;

function toNumber(cell: string): number {
  const parsed = Number.parseFloat(cell.replace("%", "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function toPct(cell: string): number | null {
  const text = cell.trim();
  if (!text || text === "—") return null;
  const parsed = Number.parseFloat(text.replace("%", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseFlakeReport(text: string | null): FlakeReport {
  if (!text) return { window: null, rows: [] };

  const windowMatch = text.match(WINDOW);
  const rows: FlakeRow[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    const cells = trimmed
      .slice(1, trimmed.endsWith("|") ? -1 : undefined)
      .split("|")
      .map((cell) => cell.trim());
    // Skip the header row and the `| --- |` separator; data rows carry a
    // numeric run count in column two.
    if (cells.length < 7) continue;
    if (!/^\d+$/.test(cells[1] ?? "")) continue;
    rows.push({
      workflow: cells[0]!,
      runs: toNumber(cells[1]!),
      failures: toNumber(cells[2]!),
      failurePct: toPct(cells[3]!),
      rerunPasses: toNumber(cells[4]!),
      flakePct: toPct(cells[5]!),
      overThreshold: (cells[6] ?? "").toLowerCase() === "yes",
    });
  }

  return {
    window: windowMatch
      ? { from: windowMatch[1]!, to: windowMatch[2]!, generatedAt: windowMatch[3]! }
      : null,
    rows,
  };
}
