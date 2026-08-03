# Flake report

Window 2026-07-27T16:21:49Z → 2026-08-03T16:21:49Z; generated 2026-08-03T16:21:49Z.

| Workflow | Completed runs | Failures | Failure % | Rerun-passes | Flake % | >5% threshold |
| --- | --- | --- | --- | --- | --- | --- |
| App CI | 102 | 4 | 3.9% | 1 | 1.0% | no |
| Protocol CI | 101 | 1 | 1.0% | 1 | 1.0% | no |
| Server CI | 103 | 0 | 0.0% | 1 | 1.0% | no |
| Nightly Lifecycle | 7 | 5 | 71.4% | 0 | 0.0% | no |

A rerun-pass is a run whose latest attempt succeeded with `run_attempt > 1`: an earlier attempt on the same commit failed and the rerun passed — the flake signal. Cancelled and skipped runs are excluded from the denominator.

_Informational only (ADR 0017): the threshold is computed but does not alert. Alerting is deliberately deferred until this report has enough history to prove the threshold meaningful._
