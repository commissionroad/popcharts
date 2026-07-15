# ADR 0019: AI Verdict Quality Program (Review + Resolution Evals)

Status: Accepted

Date: 2026-07-14

## Context

ADR 0011 hardened the review *pipeline* (safe fetching, retries, output
validation) and ADR 0012 built resolution on the same architecture. Neither
program measures whether the **verdicts** are any good, and the 2026-07-14
full-lifecycle test session showed they often are not:

- Five identically-shaped synthetic markets drew reject ×2 and
  manual_review ×3 from the local Ollama reviewer; a mundane binary sports
  question was rejected while a near-twin was approved. Verdicts are a
  lottery run-to-run on the same content.
- A clearly non-binary question ("How many goals will be scored…?") was
  approved despite the heuristic layer scoring objectivity 2/5 — the model
  overrode the soft signal.
- A false REJECT is terminal: `rejectMarket` is a one-way on-chain
  transition, the creator loses the market and the creation fee, and there
  is no appeal surface.
- Nothing evaluates the judgment dimensions that matter for real markets:
  whether a *future* source will be authoritative and reachable at
  resolution time, whether the question is specific enough to be publicly
  knowable, whether data questions (temperature, prices) have verifiable
  historical series to anchor on, and whether the source is timestamped
  well enough to avoid resolution race conditions.

Only the deterministic hard-flag layer behaves reproducibly. We have no
dataset, no consistency measurement, and no gate that stops a prompt change
from making verdicts worse. The same applies to resolution verdicts
(outcome/confidence/abstention), which share the provider registry and
untrusted-output parsing.

## Decision

Stand up a measured quality program for both verdict services before
tuning any prompts: an offline eval harness against the service HTTP seams,
a labeled scenario dataset built from an explicit failure taxonomy, verdict
policies that make irreversible actions require corroboration, and a CI
consistency lane that fails on regression. Prompt and guardrail iteration
happens only against these metrics. Local defaults stay LLM-backed
(heuristic mode remains an explicit, temporary test tool).

Principles:

1. **Measure before tuning.** No prompt change lands without before/after
   eval numbers.
2. **Determinism where possible, judgment where necessary.** Anything
   checkable without a model (dates parse and are future, sources resolve,
   binary phrasing, timestamped source fields) becomes a deterministic
   pipeline stage; the model judges only what remains.
3. **Irreversible actions need corroboration.** An LLM-only reject must not
   burn a market: reject executes on-chain only when a deterministic hard
   flag agrees or a second independent model run concurs; otherwise the
   verdict downgrades to manual_review.
4. **Consistency is a tracked metric,** not an anecdote: same input, N runs,
   agreement rate per provider/model/prompt-version.

## Progress

Harness (`server/src/ai-review/evals/`, sibling for resolution):

- [ ] Eval runner: feed a scenario set through the review service N times
      per case (service HTTP seam; no chain, no UI), recording verdict,
      scores, hard flags, latency, provider/model/prompt-version.
- [ ] Metrics: per-case verdict agreement across runs, expected-vs-actual
      verdict accuracy per taxonomy class, rubric-dimension error, abstention
      calibration (resolution: outcome accuracy + confidence calibration
      against labeled outcomes).
- [ ] Report artifact (markdown/JSON) comparable across prompt versions;
      store baselines in-repo like the coverage metrics lane (ADR 0017
      pattern: in-repo, no vendor).

Dataset:

- [ ] Failure-taxonomy doc enumerating the judgment classes: future-source
      quality/authority, public knowability, temporal specificity
      (deadline, timezone, "by when" ambiguity), data-question
      verifiability (historical series exists; e.g. past temperature data),
      source timestamping / resolution race conditions, non-binary phrasing,
      private knowledge, harm classes, prompt injection, draw/edge outcomes
      (resolution).
- [ ] ~150–200 hand-labeled seed cases covering every class (approve /
      reject / manual_review expectations for review; yes / no / draw /
      too_early / abstain for resolution), each with a one-line rationale.
- [ ] Template + LLM-assisted expansion of seeds (entities, dates,
      thresholds, sources swapped) toward a thousands-scale set with
      human spot-checks; expansion scripts and the dataset live in-repo.
- [ ] Adversarial slice: injection attempts, reviewer-manipulating criteria,
      look-alike public/private questions, sources that exist but will not
      contain the answer.

Guardrails (verdict policy):

- [ ] Deterministic pre-stages promoted out of the model: resolution date
      parses and is future at creation; at least one source URL is
      well-formed and reachable (or explicitly waived); binary-phrasing
      check; timestamped-source heuristics. Each stage annotates the review
      rather than silently deciding, except existing hard flags.
- [ ] Reject-corroboration policy: on-chain reject requires hard-flag
      agreement or independent second-run concurrence; lone LLM rejects
      park as manual_review. Mirror for resolution: confident YES/NO below
      the corroboration bar parks instead of resolving.
- [ ] Prompt-version policy (closes the open ADR 0011 checkbox): bumping
      `AI_REVIEW_PROMPT_VERSION` requires an eval run recorded next to the
      baseline; define re-review behavior for in-flight jobs.

CI:

- [ ] Consistency lane (nightly / on-demand, like the flake-report lane):
      run the seed set against the local model, fail on agreement or
      accuracy regression beyond a stated tolerance; publish the trend
      in-repo.

## Exit criteria

A prompt or guardrail change can be evaluated in one command against a
labeled dataset with agreement/accuracy/calibration numbers; identical
submissions produce the same verdict (within the stated tolerance) run over
run; and no market can be terminally rejected — nor resolved YES/NO — on a
single uncorroborated model run.

## Consequences

- Verdict latency and cost rise where corroboration requires second runs;
  that is the explicit price of making irreversible actions trustworthy.
- The dataset becomes a maintained asset (new failure modes get a labeled
  case before a prompt fix), and doubles as future fine-tuning material.
- Heuristic mode stays available for deterministic pipeline tests, but
  local stacks default to LLM providers so eval numbers reflect what ships
  (review already defaults to Ollama; flip the resolution local default
  from heuristic to Ollama as part of this program).
- ADR 0011's observability items gain a consumer: verdict-distribution
  metrics feed the same trend reporting.
