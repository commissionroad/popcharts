# Flake report

Window 2026-07-20T16:15:06Z → 2026-07-27T16:15:06Z; generated 2026-07-27T16:15:06Z.

| Workflow | Completed runs | Failures | Failure % | Rerun-passes | Flake % | >5% threshold |
| --- | --- | --- | --- | --- | --- | --- |
| App CI | 135 | 0 | 0.0% | 1 | 0.7% | no |
| Protocol CI | 139 | 3 | 2.2% | 0 | 0.0% | no |
| Server CI | 138 | 4 | 2.9% | 0 | 0.0% | no |
| Nightly Lifecycle | 4 | 2 | 50.0% | 0 | 0.0% | no |

A rerun-pass is a run whose latest attempt succeeded with `run_attempt > 1`: an earlier attempt on the same commit failed and the rerun passed — the flake signal. Cancelled and skipped runs are excluded from the denominator.

_Informational only (ADR 0017): the threshold is computed but does not alert. Alerting is deliberately deferred until this report has enough history to prove the threshold meaningful._
