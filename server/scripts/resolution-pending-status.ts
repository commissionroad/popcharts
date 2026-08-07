/**
 * Operator lens on ADR 0026 pending audit rows: every judgment the runner
 * committed before proposing that the indexer has not yet confirmed, with its
 * age and the state of the job that wrote it. The decision NOT to settle these
 * automatically is recorded in ADR 0026; this listing is the visibility that
 * decision asked for.
 *
 * Usage, from server/ against the stack's generated env (never a hand-set one):
 *   bun run scripts/resolution-pending-status.ts [--json]
 */
import {
  collectPendingRows,
  formatAge,
} from "src/ai-resolution-runner/pending-status";

const rows = await collectPendingRows(new Date());

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(rows, null, 2));
} else if (rows.length === 0) {
  console.log(
    "No pending resolution rows. Every recorded judgment is confirmed.",
  );
} else {
  console.log(
    `${rows.length} pending resolution row(s) — judgments committed but not yet confirmed on-chain:\n`,
  );
  for (const row of rows) {
    console.log(
      [
        `market ${row.chainId}/${row.marketId}`,
        `verdict ${row.verdict} (${row.provider})`,
        `age ${formatAge(row.ageMs)}`,
        `job ${row.jobStatus ?? "none"}${row.jobAttempts ? ` (${row.jobAttempts})` : ""}`,
      ].join("  |  "),
    );
    if (row.question) console.log(`  ${row.question}`);
    if (row.jobLastError) console.log(`  last error: ${row.jobLastError}`);
  }
  console.log(
    "\nA long-lived row means the proposal never landed, the indexer is behind, or an operator proposed the other side (a verdict mismatch is never auto-confirmed). See ADR 0026.",
  );
}

process.exit(0);
