# Review-verdict evals (ADR 0019)

Labeled seed dataset (`dataset/`) plus a runner (`run-review-evals.ts`) that
measure the review service's VERDICT quality (`approve` / `manual_review` /
`reject`) against a running service instance. This is the review sibling of
`src/ai-resolution/evals/`; the taxonomy and label policy live in
`docs/ai-verdict-failure-taxonomy.md`.

The runner drives the service's `POST /reviews/market` seam. It is
deliberately DB-free and chain-free: verdict quality is a service-level
property.

Dataset today: **52 cases across 29 taxonomy classes** in 7 groups —
`good` 16, `timing` 10, `vagueness` 10, `sources` 6, `knowability` 4,
`harm` 3, `injection` 2, `manipulation` 1. ADR 0019 targets 150–200 cases
across both sides; ADR 0027 section B grows them one class per pass.

## Starting an ad-hoc service instance for evals

The eval runner never starts the service; run one yourself.

**Never bind `AI_REVIEW_PORT=3002`.** 3002 is the slot-0 user stack's review
service. The stack-control guard covers process-compose control ports, not
service ports, so a bind collision fails silently and leaves the runner
measuring — or the pass killing — the user's own service. ADR 0027 assigns
review evals the off-grid port **3998**. From `server/`:

```sh
AI_REVIEW_PORT=3998 \
AI_REVIEW_PROVIDER=claude-cli \
AI_REVIEW_EVIDENCE_MODE=native \
AI_REVIEW_TIMEOUT_MS=300000 \
  bun run start:ai-review
```

`AI_REVIEW_EVIDENCE_MODE=native` is load-bearing for the CLI providers. The
service default is `precollected`, which collects evidence itself through
`AI_REVIEW_SEARCH_PROVIDER=tavily` and therefore needs `TAVILY_API_KEY`;
`claude-cli` browses for itself and needs no key. This is the same pairing
the local stack pins in `scripts/shared/aiReview/buildAiReviewEnv.ts` — the
divergence from the deployed defaults is deliberate, not drift.

Sanity-check readiness before a run: `curl http://127.0.0.1:3998/ready`. It
reports the active provider, model, evidence mode, and prompt version, and
lists every provider with its configuration errors.

### Env knobs

Read once at startup (`src/ai-review/config.ts`). The eval-relevant subset:

| Variable                     | Default                  | Notes                                                                                                                                                                                                       |
| ---------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AI_REVIEW_PROVIDER`         | `anthropic`              | `anthropic`, `claude-cli`, `codex-cli`, `heuristic`, `ollama`, or `openai`. ADR 0027 grades on `claude-cli` (subscription auth, no key); `heuristic` runs the deterministic layer only.                     |
| `AI_REVIEW_PORT`             | `3002`                   | The runner's default `--service-url` port is the same 3002. Both must be overridden for a loop run — service to 3998, runner via `--service-url`.                                                           |
| `AI_REVIEW_EVIDENCE_MODE`    | `precollected`           | `native` (the model runs its own web tools) or `precollected` (the service collects evidence and hands the model the array). Use `native` with `claude-cli`/`codex-cli`.                                    |
| `AI_REVIEW_SEARCH_PROVIDER`  | `tavily`                 | Backs `precollected` only. `tavily` needs `TAVILY_API_KEY`; `duckduckgo` is the key-free fallback.                                                                                                          |
| `AI_REVIEW_INTERNET_ACCESS`  | `search`                 | `off` / `provided_urls` / `search`.                                                                                                                                                                         |
| `AI_REVIEW_TIMEOUT_MS`       | `300000`                 | Per-review provider budget. It was `8000`, which fail-safed every model-backed run and invalidated a whole A/B (see Measured iterations). The runner's own request timeout is 360 s and must stay above it. |
| `AI_REVIEW_CLAUDE_CLI_MODEL` | `sonnet`                 | Requires a logged-in Claude Code install; the provider strips `ANTHROPIC_API_KEY` from the child env.                                                                                                       |
| `AI_REVIEW_OLLAMA_MODEL`     | `gpt-oss:20b`            | Pull it first (`ollama pull gpt-oss:20b`). Plumbing only — not a grading provider.                                                                                                                          |
| `OLLAMA_BASE_URL`            | `http://127.0.0.1:11434` | Where the Ollama daemon listens.                                                                                                                                                                            |
| `AI_REVIEW_FALLBACK_APPROVE` | `false`                  | Keep `false`. `true` lets a provider outage preserve a heuristic `approve` instead of downgrading to `manual_review` — it would score outages as judgments.                                                 |

## Running the evals

From `server/`:

```sh
bun run src/ai-review/evals/run-review-evals.ts \
  [--service-url http://127.0.0.1:3998] [--runs 3] \
  [--filter vagueness/] [--limit 10] [--out my-report]
```

`--filter` matches taxonomy-class or case-id prefixes, and `--limit` slices
the filtered list. Reports (JSON + markdown) land in `server/eval-reports/`
(gitignored) by default. `--runs` defaults to 3 and ADR 0027 requires at
least 3 for any recorded measurement — single-run smokes are documented as
worthless at the observed run-to-run variance.

`just verdict-evals` runs the same runner and then the regression check
against the committed local-model baseline. It defaults to
`http://127.0.0.1:3002` — the user stack. Point it elsewhere with
`VERDICT_EVAL_SERVICE_URL=http://127.0.0.1:3998`.

## Regression check

Compare a run's JSON report against a committed baseline from `baselines/`.
From `server/`:

```sh
bun run src/ai-review/evals/check-eval-regression.ts \
  --report eval-reports/<run>.json \
  --baseline src/ai-review/evals/baselines/<provider>.json \
  [--tolerance 0.05]
```

Exits 1 when overall accuracy or strict accuracy drops more than the
tolerance below the baseline, or when any class the baseline scored at or
above 0.99 falls below the 0.75 floor — the floor applies regardless of
tolerance, because those are the deterministic hard-flag classes and a miss
there is a terminal-reject policy bug. A per-class delta table prints either
way. Classes present in the baseline but absent from the run (a filtered
run) are reported as notices, not failures; so are classes new in the run.

**Only compare a full run.** The per-class rows degrade gracefully on a
filtered run, but the two overall rows do not: they compare the run's
overall numbers against the whole baseline's, so a `--filter`ed or
`--limit`ed report can trip `REGRESSION DETECTED` on nothing but a different
case mix. Observed on a 4-case slice — overall strict 84.6% → 75.0%, exit 1,
while every class the slice actually ran was flat. Treat the checker's exit
code as meaningful only for an unfiltered run against a same-provider,
same-prompt baseline.

The resolution side has the same checker with the same semantics
(`src/ai-resolution/evals/check-eval-regression.ts`, ADR 0027 item A1).

## Scoring

Each case runs N times against the same service:

- **accuracy** — the majority verdict lands in the case's acceptable set
  (`expected` plus any `acceptable` alternates).
- **strict accuracy** — the majority verdict equals the single `expected`
  verdict.
- **unanimous** — all N runs returned the same verdict, and none errored.

Errored runs are excluded from the majority vote and reported per case. A
review whose reasons say the review was unavailable is an errored run, not a
verdict: the service fail-safes provider outages and timeouts to
`manual_review`, and counting that as a judgment silently rewards prompts
that make the model time out. Hard-flag counts are recorded per case for
inspection but do not affect grading — on this side hard flags are the
intended output of the harm/injection classes, not an error signal (the
resolution runner's `service_error` flag is the different thing).

## Baseline status

`baselines/ollama-gpt-oss-20b.json` is the only committed review baseline:
ollama `gpt-oss:20b`, prompt `market-ai-review-v5`, 52 cases × 3 runs —
accuracy 92.3%, strict 84.6%, unanimous 61.5%.

**It is stale in two ways** and cannot referee a current run: the shipped
prompt is `market-ai-review-v6` (the coherence-reject gate, below), and the
grading provider is now `claude-cli`. ADR 0027 item A5 rebaselines both
sides after the resolution flag gate; until it lands, a regression check
against this file compares across both a prompt and a provider change. See
`baselines/README.md` for how a baseline gets committed.

## Measured iterations (negative results included)

Per ADR 0019, every prompt change is adopted or rejected on eval numbers.
Rejected iterations are recorded here so they are not retraced. All numbers
below are 52 cases × 3 runs against ollama `gpt-oss:20b` unless stated
otherwise.

| date       | version  | change                                                        | accuracy      | strict        | result   |
| ---------- | -------- | ------------------------------------------------------------- | ------------- | ------------- | -------- |
| 2026-07-15 | v3       | WHAT/WHERE/WHEN judgment contract + dispute red-flag list     | 42.3% → 75.0% | 28.8% → 67.3% | adopted  |
| 2026-07-15 | v3-draft | same contract with protective clauses as verdict-blockers     | —             | —             | rejected |
| 2026-07-16 | v4       | deterministic pre-stages + two few-shot anchors               | 75.0% → 84.6% | 67.3% → 73.1% | adopted  |
| 2026-07-17 | v5       | satire-source pre-stage + hardened disclosure-clock rule      | 84.6% → 92.3% | 73.1% → 84.6% | adopted  |
| 2026-07-25 | v6       | `incoherent_resolution` hard flag (aggregate/quantifier trap) | not measured  | not measured  | shipped  |

### 2026-07-15: policy v3 — adopted (`proposed-policy-v3.md`)

The design note `proposed-policy-v3.md` in this directory is the **adopted**
v3 proposal, kept for its rationale mapping (policy line → taxonomy class →
the real venue dispute it would have caught). It is history, not a pending
proposal; the text it proposes is live in `src/ai-review/policy.ts` and has
since been extended by v4–v6.

Two drafts were evaluated. The first moved every failure class to 100% but
tipped the model into parking venue-grade markets — **rejected**. The
adopted text keeps the WHAT/WHERE/WHEN contract and the red-flag list but
makes the optional protective clauses score-reducers instead of
verdict-blockers. Ten failure classes went 0% → 100%. Known misses left
open: contested-verb (`invade`) and event-vs-disclosure still approved,
ephemeral sources and already-determined still slipped through.

**Measurement postmortem.** The first A/B run was invalidated by a missing
`AI_REVIEW_TIMEOUT_MS` on the ad-hoc instance — the then-default 8 s against
~75 s model latency, so every call fail-safed to `manual_review` and scored
spuriously. Two fixes followed: the runner now counts provider-unavailable
fail-safes as errored runs, and the timeout default is 300 s.

### 2026-07-16: v4 — deterministic pre-stages beat prompt text

Two pre-stage detectors that never reject but stamp soft flags
(`retrospective_question`, `ephemeral_source`) took both classes 0% → 100%
and, being code, keep them there. A model `approve` downgrades to
`manual_review` while a soft flag is present; rejects stay reserved for hard
flags. Two compact worked examples in both providers' prompts moved
undefined-predicate 33% → 67%. Honest notes from that pass:
event-vs-disclosure did not take, and the two single-case source-tier
classes flipped to misses on run-to-run wobble.

### 2026-07-17: v5 — the rule beat the example

Distilling worked example 2 into an explicit disclosure-clock rule fixed
`timing/event-vs-observation` 0% → 100%; a `satirical_source` deterministic
soft flag did the same for satire. `vagueness/undefined-predicate`,
`undefined-entity`, and `unmeasurable-threshold` all reached 100%. This run
is the committed baseline.

### 2026-07-25: v6 — coherence gate, shipped without eval numbers

The `incoherent_resolution` hard flag rejects a market whose resolution
criteria can resolve opposite to its own question (the aggregate/quantifier
mismatch the local create-market script emits for "max … lower than X"
weather markets). It shipped with end-to-end verification against one real
incoherent market, **not** with a 52-case eval — the same commit switched
the default provider to headless `claude-cli`, so the v5 ollama baseline was
no longer comparable. This is the gap A5 closes; ADR 0027 item C3 separately
asks whether the coherence check can move to a deterministic pre-stage.

## Guardrails that bind runs recorded in the ADR 0027 ledger

- `--runs 3` minimum, `claude-cli` provider, off-grid port 3998.
- Never read or edit `holdout/` (a `permissions.deny` rule in the committed
  `.claude/settings.json` enforces the read side). Holdout results are
  reported only by the user's own runs.
- A baseline ships only with the prompt change that moved it, or alone as an
  explicit rebaseline. Dataset changes never ship with prompt changes.
- New case labels need an independent second-model check before sign-off;
  disagreements park the case unlabeled.
