# Flake report

Window 2026-08-24T19:49:21Z → 2026-08-31T19:49:21Z; generated 2026-08-31T19:49:21Z.

| Workflow | Completed runs | Failures | Failure % | Rerun-passes | Flake % | >5% threshold |
| --- | --- | --- | --- | --- | --- | --- |
| App CI | 27 | 1 | 3.7% | 0 | 0.0% | no |
| Protocol CI | 25 | 4 | 16.0% | 0 | 0.0% | no |
| Server CI | 27 | 1 | 3.7% | 0 | 0.0% | no |
| Nightly Lifecycle | 7 | 7 | 100.0% | 0 | 0.0% | no |

A rerun-pass is a run whose latest attempt succeeded with `run_attempt > 1`: an earlier attempt on the same commit failed and the rerun passed — the flake signal. Cancelled and skipped runs are excluded from the denominator.

_Informational only (ADR 0017): the threshold is computed but does not alert. Alerting is deliberately deferred until this report has enough history to prove the threshold meaningful._
