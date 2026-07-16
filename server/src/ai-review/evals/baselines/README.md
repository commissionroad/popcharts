# Eval baselines (ADR 0019)

Committed reference points for `check-eval-regression.ts`. Each file here is
the JSON report of one deliberately chosen run of `run-review-evals.ts` —
the report shape (`overall` + `classes` metrics) is exactly what the runner
writes; the regression check reads nothing else from it.

## How a baseline gets here

1. Run the evals against a healthy service (`just verdict-evals`, or the
   runner directly). Reports land in `server/eval-reports/`, which is
   **gitignored** — run output is never a baseline by accident.
2. Review the run: read the markdown report, check the misses, confirm the
   numbers represent behavior worth pinning (not a lucky or degraded run).
3. Copy the reviewed report JSON here and commit it in its own reviewed
   change, named for the provider/model it measures:
   - `ollama-gpt-oss-20b.json` — the local-model baseline `just verdict-evals`
     compares against.
   - `anthropic.json` — the baseline the `verdict-evals` CI lane
     (`.github/workflows/verdict-evals.yml`) compares against. The lane stays
     dormant until this file exists (and the `ANTHROPIC_API_KEY` secret is
     provisioned).

Updating a baseline is a deliberate act with a diff and a reviewer — that is
the point. A prompt/policy change that moves the numbers ships together with
the rerun baseline and the before/after numbers in the PR (ADR 0019:
"measure before tuning").

This directory intentionally starts with only this README; the first real
baselines are committed separately after reviewed eval runs.
