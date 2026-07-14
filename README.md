# ci-metrics

Machine-written datastore for the test-observability workflow (ADR 0017
Track A, `docs/adr/0017-test-observability-and-coverage-program.md` on
`main`). Only CI commits here — do not edit by hand and do not merge this
branch anywhere.

- `coverage/latest.json` — per-workspace coverage baselines (the PR
  comment's Δ reference), updated on every push to main whose CI ran that
  workspace.
- `coverage/history.jsonl` — append-only trend log, one row per workspace
  per main push.
- `TRENDS.md` — rendered view of the trend log.
- `badges/*.json` — badge endpoint payloads referenced from the main
  README.
- `FLAKES.md` — weekly flake report (arrives with a later Track A PR).
