# Flake report

Window 2026-08-10T14:24:03Z → 2026-08-17T14:24:03Z; generated 2026-08-17T14:24:03Z.

| Workflow | Completed runs | Failures | Failure % | Rerun-passes | Flake % | >5% threshold |
| --- | --- | --- | --- | --- | --- | --- |
| App CI | 17 | 0 | 0.0% | 0 | 0.0% | no |
| Protocol CI | 17 | 0 | 0.0% | 0 | 0.0% | no |
| Server CI | 17 | 0 | 0.0% | 0 | 0.0% | no |
| Nightly Lifecycle | 7 | 7 | 100.0% | 0 | 0.0% | no |

A rerun-pass is a run whose latest attempt succeeded with `run_attempt > 1`: an earlier attempt on the same commit failed and the rerun passed — the flake signal. Cancelled and skipped runs are excluded from the denominator.

_Informational only (ADR 0017): the threshold is computed but does not alert. Alerting is deliberately deferred until this report has enough history to prove the threshold meaningful._
