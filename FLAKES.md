# Flake report

Window 2026-07-07T17:10:28Z → 2026-07-14T17:10:28Z; generated 2026-07-14T17:10:28Z.

| Workflow | Completed runs | Failures | Failure % | Rerun-passes | Flake % | >5% threshold |
| --- | --- | --- | --- | --- | --- | --- |
| App CI | 172 | 13 | 7.6% | 0 | 0.0% | no |
| Protocol CI | 180 | 4 | 2.2% | 0 | 0.0% | no |
| Server CI | 180 | 2 | 1.1% | 0 | 0.0% | no |

A rerun-pass is a run whose latest attempt succeeded with `run_attempt > 1`: an earlier attempt on the same commit failed and the rerun passed — the flake signal. Cancelled and skipped runs are excluded from the denominator.

_Informational only (ADR 0017): the threshold is computed but does not alert. Alerting is deliberately deferred until this report has enough history to prove the threshold meaningful._
