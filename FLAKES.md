# Flake report

Window 2026-07-13T15:48:12Z → 2026-07-20T15:48:12Z; generated 2026-07-20T15:48:12Z.

| Workflow | Completed runs | Failures | Failure % | Rerun-passes | Flake % | >5% threshold |
| --- | --- | --- | --- | --- | --- | --- |
| App CI | 159 | 2 | 1.3% | 0 | 0.0% | no |
| Protocol CI | 163 | 1 | 0.6% | 0 | 0.0% | no |
| Server CI | 162 | 3 | 1.9% | 0 | 0.0% | no |

A rerun-pass is a run whose latest attempt succeeded with `run_attempt > 1`: an earlier attempt on the same commit failed and the rerun passed — the flake signal. Cancelled and skipped runs are excluded from the denominator.

_Informational only (ADR 0017): the threshold is computed but does not alert. Alerting is deliberately deferred until this report has enough history to prove the threshold meaningful._
