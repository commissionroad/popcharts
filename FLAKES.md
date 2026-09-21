# Flake report

Window 2026-09-14T19:02:11Z → 2026-09-21T19:02:11Z; generated 2026-09-21T19:02:11Z.

| Workflow | Completed runs | Failures | Failure % | Rerun-passes | Flake % | >5% threshold |
| --- | --- | --- | --- | --- | --- | --- |
| App CI | 0 | 0 | n/a | 0 | n/a | no |
| Protocol CI | 0 | 0 | n/a | 0 | n/a | no |
| Server CI | 0 | 0 | n/a | 0 | n/a | no |
| Nightly Lifecycle | 7 | 7 | 100.0% | 0 | 0.0% | no |

A rerun-pass is a run whose latest attempt succeeded with `run_attempt > 1`: an earlier attempt on the same commit failed and the rerun passed — the flake signal. Cancelled and skipped runs are excluded from the denominator.

_Informational only (ADR 0017): the threshold is computed but does not alert. Alerting is deliberately deferred until this report has enough history to prove the threshold meaningful._
