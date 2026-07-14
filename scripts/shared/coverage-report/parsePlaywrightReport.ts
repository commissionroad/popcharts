export interface E2eRetrySummary {
  /** Tests that passed only on retry (Playwright outcome "flaky"). */
  flaky: number;
  /** Tests that ran (expected + unexpected + flaky; skipped excluded). */
  total: number;
}

interface PlaywrightStats {
  expected?: number;
  unexpected?: number;
  flaky?: number;
  skipped?: number;
}

/**
 * Extract retry data from a Playwright JSON report. Only the top-level
 * `stats` block is read — Playwright counts a test "flaky" when a retry
 * passed after a failed attempt, which is exactly the signal ADR 0017
 * surfaces in the PR comment. Returns null when the text is absent or not
 * a Playwright report.
 */
export function parsePlaywrightReport(
  text: string | null,
): E2eRetrySummary | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as { stats?: PlaywrightStats };
    const stats = parsed.stats;
    if (!stats || typeof stats !== "object") return null;
    const expected = stats.expected ?? 0;
    const unexpected = stats.unexpected ?? 0;
    const flaky = stats.flaky ?? 0;
    return { flaky, total: expected + unexpected + flaky };
  } catch {
    return null;
  }
}
