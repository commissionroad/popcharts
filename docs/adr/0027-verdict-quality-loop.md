# ADR 0027: Verdict-Quality Improvement Loop

Status: Proposed

Date: 2026-08-07

## Context

ADR 0019 stood up the measurement substrate for AI verdicts. Most of it now
exists, but it is uneven and nothing drives it forward:

- **Review evals** (`server/src/ai-review/evals/`): 52 labeled cases across 7
  taxonomy classes, a runner (`run-review-evals.ts`), a regression checker
  (`check-eval-regression.ts`), one committed baseline
  (`baselines/ollama-gpt-oss-20b.json`), and — until this ADR — a dormant
  weekly CI lane (`.github/workflows/verdict-evals.yml`), deleted here:
  this program is local-only by user decision (2026-08-08) and never runs
  in or reports through CI (see A6). There is no top-level README and no
  measured-iteration ledger on this side.
- **Resolution evals** (`server/src/ai-resolution/evals/`): 35 labeled cases
  across 6 classes, a runner, a README with a measured-iteration ledger, and
  two committed baselines (`claude-cli-sonnet.json`, `ollama-gpt-oss-20b.json`).
  There is **no regression checker** on this side.
- ADR 0019 targets 150–200 labeled cases. We have 87 total. The adversarial
  slices are the thinnest (review 6, resolution 3).
- **Zero cost/latency instrumentation.** Neither service emits per-run
  structured cost, token, or latency records.

Meanwhile, the safety wiring around the verdicts regressed silently, which
is the strongest argument for a standing loop rather than one-off pushes:
the reject/resolve corroboration policy (ADR 0019 principle 3) was wired
into both runners in `c5d6eccf` and silently un-wired the same day by the
cross-cutting rewrite `b3a6ddda` — modules and unit tests survived, so CI
stayed green; `deriveVerdict` in `server/src/ai-resolution/resolver.ts`
never sees hard flags, so a run that flags `prompt_injection` and still
returns a confident YES auto-proposes on-chain; every in-repo deploy seam
stamps a dispute window of 0; and the draft-review publish gate defaults to
the heuristic provider with `POPCHARTS_DRAFT_REVIEW_PROVIDER` set nowhere.
Phase 0 below restores this wiring. This ADR is the process that keeps it
restored: measured, catalogued, and re-checked, so the next `b3a6ddda`
fails a test instead of passing CI.

ADR 0026 (durable resolution intent, PR #504) is rebuilding the resolution
write path around a `commit_state` column: readers must treat only
confirmed rows as real resolutions. Any corroboration supporting-row
semantics this program restores or measures must respect that reader rule —
a pending intent row is not corroborating evidence.

## Relationship to ADR 0019

ADR 0019 defines **what to measure and what the policy is**: the taxonomy,
the harness shape, the corroboration principle, the prompt-version rule.
This ADR defines **the standing process that grows and consumes it**: a
catalogue of bounded improvement items, a loop that executes one per pass,
and guardrails that keep the loop from corrupting its own measuring stick.
ADR 0019's own checklist is stale (11 unchecked boxes despite most of the
work existing); reconciling it is a catalogue item here (E1), not a
rewrite.

## Decision

Stand up a **standing, catalogue-driven verdict-quality improvement loop**.

One bounded catalogue item per pass, executed by the
`skills/engineering/verdict-next/SKILL.md` skill via the `/verdict-next`
command, driven attended via `/loop` first (~5 passes), then as a nightly
scheduled task (`skills/engineering/verdict-next/nightly-task.md`). The
loop produces **PRs only, never merges; the user lands every change.**

Principles:

1. **One item, one PR, one ledger row.** Depth per item is the point. Each
   pass opens this ADR, executes the first eligible unchecked item (or an
   explicitly requested one), publishes a PR labelled `verdict-loop`, ticks
   the box in that PR, and appends a row to the Ledger below.
2. **The eval numbers are the only currency.** No prompt, policy, or
   dataset change is adopted on argument or on a single-run smoke. Rejected
   iterations are recorded so they are never retraced.
3. **Never grade your own homework.** The loop must not read or edit the
   frozen holdout, must not ship a baseline except with the prompt change
   that moved it (or alone, A5), and must not label cases without an
   independent second-model check.
4. **Regressions must fail something.** Every piece of safety wiring this
   program restores or adds gets a test that fails if the wiring is removed
   again — the `b3a6ddda` lesson.

## Phase 0 — in-flight prerequisites (not loop items)

Five PRs restoring the regressed safety wiring are in flight. These are
**status lines, not catalogue items**: the skill's preflight reads them and
reports no-op (phase 0 incomplete) until every line says landed. When a PR
lands, the user (or the landing session) edits its line to
`status: landed (PR #N)`.

- **P0.1 Resolution-runner corroboration rewired** — the surviving
  `ai-resolution-runner/corroboration.ts` module and `corroborationEnabled`
  knob get their call site back, with a regression test that fails if the
  call site is removed. Supporting-row reads respect the ADR 0026
  `commit_state` reader rule. — **status: landed ([#521](https://github.com/commissionroad/popcharts/pull/521))**
- **P0.2 Draft-review corroboration restored** — the review-side
  reject-corroboration policy (deleted as orphaned in `c276473a`) returns
  with a revert-catching test. — **status: landed ([#522](https://github.com/commissionroad/popcharts/pull/522))**
- **P0.3 Non-zero dispute window in deploy seams** — non-local deploys must
  supply explicit nonzero dispute config or refuse to run (the local zero
  stays: a locked user decision the lifecycle harness depends on), per
  ADR 0024. — **status: landed ([#523](https://github.com/commissionroad/popcharts/pull/523))**
- **P0.4 Hard-flag gate in `deriveVerdict`** — a run carrying blocking hard
  flags (e.g. `prompt_injection`) can never yield `resolve_yes`/`resolve_no`
  regardless of confidence ("the flag-gate PR"). — **status: landed
  ([#524](https://github.com/commissionroad/popcharts/pull/524))**
- **P0.5 Draft-review publish gate gets a model default** — the deployed
  configuration sets an explicit model-backed
  `POPCHARTS_DRAFT_REVIEW_PROVIDER` (or documents why heuristic remains
  correct per environment). — **status: landed ([#525](https://github.com/commissionroad/popcharts/pull/525))**

## Catalogue

Eligibility order: A → B → C → D → E → M, first unchecked box, unless the
pass argument names a specific id. Two machine-readable tags may appear on
a checkbox line and the skill honors them, skipping to the next eligible
item:

- `DEPENDS(<id>)` — ineligible until the named item's box is ticked (for
  `P0-*` ids: until that Phase-0 line says landed).
- `BLOCKED(<reason>)` — ineligible until the user removes the tag.

### Section A — Measurement

- [x] **A1 [measurement]** Port the regression checker to resolution evals:
      `server/src/ai-resolution/evals/check-eval-regression.ts` (+ unit
      test) with the same tolerance and guarded-class semantics as the
      review-side checker. Acceptance: a deliberately degraded fixture
      report fails the check; a baseline-equal report passes.
- [x] **A2 [measurement]** Review-side evals README + measured-iteration
      ledger, mirroring `server/src/ai-resolution/evals/README.md`: runner
      instructions, env knobs, scoring semantics, and a "Measured
      iterations" section seeded from recoverable history (including the
      status of `proposed-policy-v3.md`).
- [ ] **A3 [measurement]** Per-run cost/latency/token structured logging in
      both services: provider, model, promptVersion, latencyMs, tokens
      where reported, derived cost where a price table exists. In-repo, no
      vendor. Acceptance: a unit test asserts the line shape; a full eval
      run yields per-provider aggregates from logs alone.
- [ ] **A4 [measurement]** SQL quality views over `market_resolutions` and
      `market_draft_reviews`: parked/manual-review rate over time,
      confidence histograms, per-provider verdict drift. **GENERATED
      SURFACE:** any drizzle migration ships in a minimal generated-first
      PR per house rule.
- [ ] **A5 [measurement]** DEPENDS(P0-flag-gate-landed) Rebaseline both
      sides after the flag gate (claude-cli, `--runs 3`, full sets). The
      gate changes recorded verdicts, so current baselines misreport
      regressions. Acceptance: new baseline JSONs as reviewed diffs,
      before/after numbers in the PR body, ledger rows appended. Ships
      alone — no prompt or dataset changes ride along.
- **A6 — removed by user decision (2026-08-08).** This program is
  local-only: the loop never runs in, gates on, or reports through CI, and
  ADR 0019's dormant weekly lane (`verdict-evals.yml`) was deleted with
  this decision. claude-cli runs recorded in the Ledger are the canonical
  quality record. Not a selectable item; kept here so the id sequence and
  this decision stay visible.
- [ ] **A7 [measurement]** Operator lens for parked rows: extend the
      pending-rows lens shipped by PR #518 (`server` `resolution:pending`
      script) to also list `manual_review` parked rows — market, provider,
      confidence, hard flags, age — so parked-rate drift is visible before
      A4's views exist.
- [ ] **A8 [measurement]** Runner holdout-exclusion: both eval runners
      refuse to load cases from a `holdout/` directory (path filter plus a
      unit test that fails if the filter is removed). Built without reading
      holdout contents; see Guardrails.

### Section B — Dataset growth (repeating; one taxonomy class per pass)

Target: 150–200 labeled cases total (ADR 0019), from 87 today. Per pass:
one taxonomy class, at least 3 new labeled cases with a one-line rationale
each, every label checked by an independent second model before user
sign-off. Dataset changes never ship with prompt changes.

- [ ] **B1 [dataset]** Coherence-mismatch class exists on both sides — the
      aggregate/quantifier trap that only the prompt-side coherence gate in
      `server/src/ai-review/policy.ts` handles today. Cases include the
      coherent mirror case (must NOT be rejected).
- [ ] **B2 [dataset]** Review adversarial slice grown 6 → ~15 (injection
      variants, reviewer-manipulating criteria, look-alike public/private).
- [ ] **B3 [dataset]** Resolution adversarial slice grown 3 → ~12
      (injection inside evidence, sources that exist but cannot contain the
      answer).
- [ ] **B4 [dataset]** Every existing class ≥ 8 cases per side.
- [ ] **B5 [dataset]** Combined total ≥ 150, with the holdout populated
      (the named user task — see Guardrails) and excluded from all
      baselines (A8).

### Section C — Red team and defenses

- [ ] **C1 [red-team]** Measure the injection corpus against the live
      pipeline (real service path, not only the eval seam); commit a
      findings note; any successful injection becomes a labeled case plus a
      defense item appended here.
- [ ] **C2 [red-team]** Delimiting/fencing experiment — fence untrusted
      market content in prompts; adopt only if full `--runs 3` evals on
      both sides meet or beat baseline; record adopted or rejected in the
      Ledger.
- [ ] **C3 [red-team]** Deterministic backstop investigation for the
      coherence gate — decide with a committed note whether an
      aggregate/quantifier detector can run as a deterministic pre-stage
      (ADR 0019 principle 2); spawn a follow-up item if yes, record why not
      if no.
- [ ] **C4 [red-team]** Evidence-starvation classes — labeled cases where
      the model must park because the evidence cannot decide; measure park
      behavior and confidence calibration on them.

### Section D — Prompt/policy iterations (repeating, strictly eval-gated)

No fixed list; items are appended here from observed eval misses, one per
pass. Rules: one change per PR; full `--runs 3` before/after numbers in the
PR body; the Ledger records adopted AND rejected iterations with their
numbers (the resolution README's v2–v2d postmortem is the model); a
baseline ships only with the prompt change that moved it, and never
together with dataset changes.

### Section E — Hygiene

- [ ] **E1 [meta]** Reconcile stale ADR checkboxes against reality — ADR
      0019 (11 unchecked boxes, most work exists), ADR 0012 and ADR 0024
      residue. Tick with evidence anchors (file paths, PR numbers); do not
      rewrite history or scope.
- [ ] **E2 [meta]** Doc drift sweep — known stale after the runner
      consolidation: `docs/ai-review-runner-design.md`, backend runtime
      architecture notes. Align docs with code or delete them; the wiki
      removal (PR #510) set the precedent that stale summaries are worse
      than none.
- [ ] **E3 [meta]** Skill-adapter integrity test under `scripts/test/`:
      every `.claude/commands/*.md` and `.agents/skills/*/SKILL.md`
      reference to a `skills/**/SKILL.md` path must resolve on disk, and
      the verdict-next skill must retain its load-bearing strings
      (`--runs 3`, the holdout prohibition, the `verdict-loop` label).
      Fails if an adapter outlives its skill — the `b3a6ddda` class again.

### Section M — Meta (loop self-improvement)

Starts empty. Items are appended from pass retros: skill-prompt fixes,
eligibility-order changes, guardrail gaps the loop itself discovered. Meta
items follow the same one-item-per-pass rule. A meta item may NOT change
the Guardrails below or the skill's Hard prohibitions — the most it may do
is add a `NEEDS-DECISION:` question edit for the user to answer.

- [ ] **M1 [meta]** The Ship playbook writes the Ledger row's PR number in
      the same commit that precedes PR creation, so the number cannot be
      known; specify the two-step (commit with #TBD, amend after
      `gh pr create` returns the number) in the skill's Ship section.
- [ ] **M2 [meta]** `server/src/ai-resolution/evals/README.md` tells a pass
      to start the resolution service on `AI_RESOLUTION_PORT=3004` — the
      slot-0 user-stack port this ADR and the skill forbid. The skill sends
      every measured pass to that README as "the single source for env knobs
      and provider facts", so the two load-bearing instructions contradict
      each other and the README is the one a reader is holding when they
      type the command. Point it at the off-grid 3999 with the same
      silent-bind warning the review-side README now carries (A2), and
      re-check every other port literal in both evals READMEs.

## Guardrails

These are constraints on the loop, not aspirations. The skill enforces
them; review enforces them again.

1. **`--runs 3` minimum** for any verdict measurement, claude-cli provider.
   Single-run smokes are documented as worthless at observed variance (the
   v2d smoke showed a case "fixed" that the 3-run eval showed wrong 3/3).
   Runs carrying the `service_error` hard flag count as errors, not
   outcomes.
2. **Baselines change only as reviewed diffs.** Run output lands in
   gitignored `server/eval-reports/`; a baseline is a deliberate copy with
   a reviewer. A baseline ships only with the prompt change that moved it,
   or alone (A5). Dataset changes never ship with prompt changes. The eval
   lane is NEVER a required check.
3. **Frozen holdout.** A holdout slice under each evals directory
   (`server/src/ai-review/evals/holdout/`,
   `server/src/ai-resolution/evals/holdout/`) that only the user edits.
   **Populating the holdout is a named user task, not a loop item**; the
   loop's contribution is A8 (runner exclusion). Enforcement is a
   `permissions.deny` Read rule on both paths in the committed
   `.claude/settings.json`, plus human review of every loop PR. Named
   residual: once a holdout case is committed, its content is in git
   history, and the deny rule covers only the working-tree paths — a
   process that reads git objects can still see it. The deny rule makes
   accidental reads fail loudly; review catches deliberate ones. Holdout
   results are reported only by the user's own runs.
4. **New case labels require an independent second-model check** before
   user sign-off; disagreements park the case for the user, unlabeled.
5. **Gate failures are ledger rows, and two in a row halt the loop.** A
   pass whose workspace gate stays red after one fix attempt ships a
   docs-only PR appending a gate-failed row to the Ledger. Preflight halts
   when the last two Ledger rows are gate-failed and waits for the user.
   The Ledger is the loop's only cross-pass memory — there is no other
   state between passes.
6. **Every pass appends a Ledger row**, including no-change and rejected
   passes.

## Running the loop

The catalogue is walked one item per pass by
`skills/engineering/verdict-next/SKILL.md`; thin `/verdict-next` adapters
(`.claude/commands/verdict-next.md`, `.agents/skills/verdict-next/SKILL.md`)
are the entry points (ADR 0023's `/audit-next` pattern — adapters delegate,
never copy). To drive it attended:

```
/loop /verdict-next
```

Containment: every no-op check runs before any worktree exists; each pass
then works in a dedicated worktree named
`.worktrees/verdict-loop-<item-id>-<hhmm>` and prunes stale
`verdict-loop-*` worktrees during preflight. Model-backed eval runs start
ad-hoc service instances on the off-grid ports `AI_RESOLUTION_PORT=3999`
and `AI_REVIEW_PORT=3998` — never 3004/3002, which belong to the slot-0
user stack; the stack-control guard does not cover service ports, and a
silent bind failure would leave `/ready` answering from the user's service.
The pass records the spawned PID and kills only that PID.

After ~5 clean attended passes, the loop moves to a nightly scheduled task;
the procedure is `skills/engineering/verdict-next/nightly-task.md`
(installed outside this repo). Scheduled runs execute in default permission
mode — an action the allow rules do not cover is a pass that stops and
reports rather than escalates. PRs only; the user lands via `/land`.

## Metrics and exit criteria ("healthy")

The program is healthy — and the nightly cadence can relax to weekly —
when:

- datasets are at target (B5: combined ≥ 150; adversarial ~15/~12; holdout
  populated by the user and runner-excluded),
- both regression checkers exist and run green in ledger-recorded local
  claude-cli runs (`--runs 3`) — the canonical quality record; the program
  never gates or reports through CI (user decision, 2026-08-08),
- per-run cost/latency instrumentation is live and the SQL quality views
  answer drift questions from production data (A3 + A4),
- the Ledger shows at least one full A→E cycle with no guardrail
  violations.

The catalogue never empties (B, D, and M repeat by design); "healthy" is a
steady state, not completion.

## Deferred / out of scope

- **Provider cost experiments** — deferred until A3 produces real
  per-verdict cost data to compare against.
- **Deployed draft-gate provider decision** — P0.5 sets the wiring; the
  production provider choice waits on API credits, outside this program's
  scope.
- **Fixes to the resolution money path beyond Phase 0** — the propose →
  finalize → redeem chain is exercised by this program's measurements but
  changed only through its own reviewed PRs with revert-catching tests.
- **Thousands-scale template expansion of the dataset** — not before the
  hand-labeled target and holdout exist.

## Ledger

One row per pass, appended by the skill (newest last). `type` is the item's
playbook tag; `metric-before`/`metric-after` are the headline eval numbers
where the pass measured, `—` where it did not.

| date       | item | type        | metric-before | metric-after | PR   | notes                                                                    |
| ---------- | ---- | ----------- | ------------- | ------------ | ---- | ------------------------------------------------------------------------ |
| 2026-08-08 | A1   | measurement | —             | —            | #533 | shipped: resolution regression checker + fixtures; proof runs in PR body |
| 2026-08-09 | A2   | measurement | —             | —            | #537 | shipped: review evals README + measured-iteration ledger (v3–v6); bounded claude-cli proof run in PR body; appended M2 |
