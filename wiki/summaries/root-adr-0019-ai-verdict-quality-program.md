---
type: summary
title: Repo ADR 0019 — AI verdict quality program
description: Measured quality program for review and resolution verdicts — offline eval harness at the service HTTP seams, ~150–200-seed labeled failure-taxonomy dataset (template-expanded), deterministic pre-stages, reject-corroboration policy (no terminal reject/resolve on one uncorroborated model run), CI consistency lane, prompt-version eval policy.
sources:
  - docs/adr/0019-ai-verdict-quality-program.md
updated: 2026-07-17
---

# Repo ADR 0019: AI Verdict Quality Program (Review + Resolution Evals)

**Status: Accepted; core harness landed (review + resolution), guardrail
policy still open.** Dated 2026-07-14. Complements
[root ADR 0011](root-adr-0011-ai-review-service-hardening.md) (pipeline
hardening) and [root ADR 0012](root-adr-0012-ai-assisted-resolution.md)
(resolution build): those made the pipelines robust; neither measures
whether the **verdicts** are any good. The same PR that filed the ADR
(#226, merged 2026-07-15) landed the first slice — see the status note
under Program below. The ADR's own checklist is still all-unticked
(raw-source lag; the landed items should be ticked at the source if the
ADR is re-touched).

## Context (verdict-lottery findings, 2026-07-14 test session)

- Five identically-shaped synthetic markets drew reject ×2 and
  manual_review ×3 from the local Ollama reviewer; a mundane binary sports
  question was rejected while a near-twin was approved — verdicts are a
  lottery run-to-run on the same content.
- A clearly non-binary question ("How many goals…?") was approved despite
  the heuristic layer scoring objectivity 2/5 — the model overrode the soft
  signal.
- A false REJECT is terminal: `rejectMarket` is a one-way on-chain
  transition, the creator loses market and creation fee, and there is no
  appeal surface.
- Nothing evaluates the judgment dimensions that matter: future-source
  authority/reachability at resolution time, public knowability, verifiable
  historical series for data questions, source timestamping vs resolution
  race conditions.
- Only the deterministic hard-flag layer behaves reproducibly. No dataset,
  no consistency measurement, no gate stopping a prompt change from making
  verdicts worse. Resolution verdicts (outcome/confidence/abstention) share
  the exposure.

## Decision

Stand up a measured quality program for both verdict services **before
tuning any prompts**. Principles:

1. **Measure before tuning** — no prompt change without before/after eval
   numbers.
2. **Determinism where possible, judgment where necessary** — anything
   checkable without a model (dates parse and are future, sources resolve,
   binary phrasing, timestamped sources) becomes a deterministic pipeline
   stage that annotates rather than silently decides (existing hard flags
   excepted).
3. **Irreversible actions need corroboration** — on-chain reject only when
   a deterministic hard flag agrees or a second independent model run
   concurs; lone LLM rejects park as manual_review. Mirrored for
   resolution: confident YES/NO below the corroboration bar parks instead
   of resolving.
4. **Consistency is a tracked metric** — same input, N runs, agreement rate
   per provider/model/prompt-version.

Local defaults stay LLM-backed (heuristic mode remains an explicit,
temporary test tool; the resolution local default flips heuristic → Ollama
as part of this program).

## Program

**Landed 2026-07-14/15 (PR #226, same PR as the ADR):** the review-side
eval runner (`server/src/ai-review/evals/run-review-evals.ts`, N runs per
case at the HTTP seam, provider-unavailable fail-safes counted as errored
runs), 52 hand-labeled seed cases in per-class TS modules
(`evals/dataset/` — good/timing/vagueness/sources/knowability/adversarial/
disputes, pinned to the
[failure taxonomy](ai-verdict-failure-taxonomy.md)), the taxonomy doc
itself, and the first exercise of the measure-before-tuning rule: review
policy/prompt v3 (`market-ai-review-v3`) adopted with before/after eval
numbers (42→75% accuracy) recorded in
`server/src/ai-review/evals/proposed-policy-v3.md`. **Landed 2026-07-16
(PRs #236/#237/#238):** the resolution-side sibling harness
(`server/src/ai-resolution/evals/run-resolution-evals.ts` with a 35-seed
dataset — 9 clear-YES / 9 clear-NO / 5 too_early / 3 draw / 6 abstain /
3 injection, all forced through the LLM path); the deterministic review
pre-stages promoted into `heuristics.ts` (with few-shot anchors) plus the
first recorded eval baseline (`evals/baselines/ollama-gpt-oss-20b.json`);
and the CI consistency lane — a verdict-eval regression check
(`check-eval-regression.ts`) wired to a dormant
`.github/workflows/verdict-evals.yml` that fails on agreement/accuracy
regression beyond tolerance. **Still open:** template/LLM-assisted
expansion beyond the hand-labeled seeds, the reject-corroboration policy
(no terminal reject/resolve on one uncorroborated run), the
`AI_REVIEW_PROMPT_VERSION` eval-gate that closes the 0011 checkbox, and the
resolution local-default flip (heuristic → Ollama).

- **Harness** (`server/src/ai-review/evals/`, sibling for resolution): eval
  runner at the service HTTP seam (no chain, no UI), N runs per case;
  metrics for cross-run agreement, expected-vs-actual accuracy per taxonomy
  class, rubric-dimension error, abstention calibration (resolution adds
  outcome accuracy + confidence calibration); report artifact comparable
  across prompt versions, baselines in-repo per the
  [ADR 0017](root-adr-0017-test-observability-and-coverage-program.md)
  pattern.
- **Dataset**: [failure-taxonomy doc](ai-verdict-failure-taxonomy.md)
  (future-source quality, public
  knowability, temporal specificity, data-question verifiability, source
  timestamping/race conditions, non-binary phrasing, private knowledge,
  harm classes, prompt injection, draw/edge outcomes); ~150–200 hand-labeled
  seeds with one-line rationales; template + LLM-assisted expansion toward
  thousands-scale with human spot-checks, all in-repo; adversarial slice
  (injection, reviewer manipulation, look-alike public/private questions,
  sources that exist but won't contain the answer).
- **Guardrails (verdict policy)**: deterministic pre-stages promoted out of
  the model; the reject-corroboration policy above; prompt-version policy —
  bumping `AI_REVIEW_PROMPT_VERSION` requires an eval run recorded next to
  the baseline plus defined re-review behavior for in-flight jobs (closes
  the open ADR 0011 checkbox).
- **CI**: nightly/on-demand consistency lane (like the flake-report lane)
  running the seed set against the local model, failing on agreement or
  accuracy regression beyond a stated tolerance; trend published in-repo.

## Exit criteria

One command evaluates a prompt/guardrail change against the labeled dataset
with agreement/accuracy/calibration numbers; identical submissions produce
the same verdict within tolerance; no market can be terminally rejected —
nor resolved YES/NO — on a single uncorroborated model run.

## Consequences

- Verdict latency and cost rise where corroboration needs second runs — the
  explicit price of trustworthy irreversible actions.
- The dataset becomes a maintained asset (new failure modes get a labeled
  case before a prompt fix) and doubles as future fine-tuning material.
- ADR 0011's observability items gain a consumer: verdict-distribution
  metrics feed the same trend reporting.

## Related pages

- [../entities/ai-review-service.md](../entities/ai-review-service.md)
- [../concepts/ai-assisted-resolution.md](../concepts/ai-assisted-resolution.md)
- [../concepts/testing-strategy.md](../concepts/testing-strategy.md)
- [../entities/server-workspace.md](../entities/server-workspace.md)
