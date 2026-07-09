# AI-Assisted Resolution — Service & Runner Design

Status: **Accepted (2026-07-09).** This is the design doc ADR 0012 requires
before implementation. It defines the verdict contract, data model, runner
lifecycle, safety valves, key custody, and the `bypassAiResolution` interaction,
then breaks the build into slices. The four safety/scope decisions are resolved
in [§13](#13-decisions-resolved-2026-07-09); the rest is settled by mirroring the
AI-review vertical.

Companion docs: `docs/ai-review-runner-design.md` (the architecture this
mirrors), ADR 0012 (the vertical), ADR 0008 (resolver hooks / `bypassAiResolution`),
ADR 0010 (postgrad resolution indexing), ADR 0009/0011 (shared operator auth).

## 1. Purpose

Decide the outcome of a graduated postgrad market from public evidence and
submit it on-chain — automatically for confident, unambiguous cases; parked for
a human otherwise. Resolution is the second half of the AI differentiator and
the keystone that unblocks redemption UX, the `resolved` market state, and the
full-lifecycle E2E suite.

It is built as a **sibling of AI review**, not a new architecture. Wherever a
choice is already made in `server/src/ai-review*`, we clone it.

## 2. Scope and non-goals

In scope: a stateless resolution **service** (provider-pluggable outcome
determination), a DB-leased **runner** (discovers due markets, persists
verdicts, submits `resolve`/`cancel`), an append-only audit trail, an operator
override path, and a smoke test.

Out of scope (deferred, consistent with ADR 0012): bonded disputes / fraud
proofs, multi-turn research, mainnet resolver custody hardening, and anything
deployment-related (ADR 0015).

## 3. On-chain surface this targets

`CompleteSetBinaryMarket` (`protocol/contracts/postgrad/CompleteSetBinaryMarket.sol`):

- `resolve(Side side)` — `onlyResolver`; requires `Status.Trading`; sets the
  winning side, flips status to `Resolved`, asserts resolved-solvency, emits
  `MarketResolved(side)` (`:337`).
- `cancel()` — `onlyResolver`; requires `Status.Trading`; flips to `Cancelled`
  (draw — YES and NO each redeem half), emits `MarketCancelled()` (`:347`).
- User claim paths (already on-chain, consumed by the ADR 0013 redemption UX):
  `redeem(side, amount)` for the winning side, `redeemCancelled(yes, no)` for a
  draw (`:359`, `:383`).

Two facts that shape the runner:

1. **The resolver is a single immutable address**, set on
   `CompleteSetPostgradAdapter` (`:131`) and passed to every child market
   (`:171`). One key resolves all postgrad markets from that adapter — exactly
   analogous to the review-manager key, so custody is a solved shape (§10).
2. **There is no on-chain `resolutionTime` gate today.** `resolve`/`cancel` only
   require `Status.Trading`; the timing data lives in market metadata
   (`markets.resolution_time`, `market_metadata.resolution_criteria` /
   `resolution_sources` / `resolution_url`). A single "resolution time" is not
   enough for AI resolution — see **Temporal validity guardrails** below, which
   defines the window model, the off-chain runner gates, and a minimal on-chain
   floor guard (which closes ADR 0008's open "post-`resolutionTime` gating"
   item).

## Temporal validity guardrails (resolution windows)

**Why a single `resolutionTime` is insufficient.** An AI resolver relying on one
"resolve after" timestamp will make timing errors on two common market shapes:

- **Fixed-event markets** ("Will Team A beat Team B on 2026-03-01?"): the outcome
  is only knowable *after* the event concludes. Resolving during the match — or
  treating a postponed match as a loss — is wrong.
- **Open-ended markets** ("Will X happen in 2026?"): **YES** is knowable the
  moment X happens (possibly months early), but **NO** cannot be confirmed until
  the whole window has elapsed. A symmetric single deadline forces you to either
  block early YES or allow premature NO.

The core requirement is therefore a **per-outcome earliest-resolution time**, not
one deadline. Precedent (from prior research, unverified here): Polymarket/UMA
carry resolution rules + an eligibility time and a "too early" outcome; Trueo has
an immutable earliest-resolve field and prefers *cancel* over a forced YES/NO
when a market lacks clear expiry, sources, or objective criteria.

**The model (kept deliberately minimal — two off-chain gates + one on-chain
floor).** Rather than six fields, the essential asymmetry needs just two
immutable per-market timestamps in `market_metadata`, plus an optional evidence
window the model reads as guidance:

- `no_not_before` (required) — earliest a **NO** (and a **draw**) verdict may be
  submitted. This is the canonical deadline; it maps the existing
  `resolution_time`. NO/draw are only certain once the window closes.
- `yes_not_before` (optional; default = `no_not_before`) — earliest a **YES** may
  be submitted. Set earlier than the deadline only for open-ended markets that
  admit early YES.
- `observation_window_start` / `observation_window_end` (optional) — the span
  during which an event "counts," passed to the model as evidence-scoping
  guidance (not a hard gate). Folds into `resolution_criteria` if unset.

This subsumes codex's `observationStartTime` / `observationEndTime` /
`earliestResolutionTime` / `noEarlierThan` into two enforced gates plus optional
guidance — same coverage, less surface to get wrong or leave half-populated.

**`cancel()` is deliberately *not* time-gated.** A postponed match or abandoned
acquisition may need cancellation *before* the deadline, and cancel is
operator-only anyway (draws always park, §5). Gating cancel on a floor would trap
exactly the escape hatch it exists for.

**Enforcement in layers (defense in depth, cheapest first):**

1. **Creation + AI review (ADR 0011/0013).** A market must declare a deadline
   (`no_not_before`), credible public sources, and objective criteria. Review
   *rejects or flags* markets lacking clear expiry/source/timing — bad markets
   never reach the resolver. This extends the review policy and the create form's
   metadata (ADR 0009 schema, ADR 0013 UI).
2. **Runner deterministic gate.** Before spending any model call, the runner
   refuses to consider a YES before `yes_not_before` or a NO/draw before
   `no_not_before`. Pure timestamp arithmetic, no model, no gas.
3. **Model structured `too_early`.** Add `too_early` to the outcome union. Even
   past a gate, the model can judge the event unconcluded (e.g. a match went to
   extra time, results not yet official) → the runner **re-queues with backoff**
   (`run_after` bump), it is *not* a failure and *not* a resolution.
4. **On-chain floor guard (minimal contract change).** Add an immutable
   `earliestResolutionTime` to `CompleteSetBinaryMarket` and make `resolve(side)`
   revert before it. `cancel()` stays ungated. The floor = the earliest any
   legitimate resolve could occur (`min(yes_not_before, no_not_before)` =
   `yes_not_before`). This is the backstop that holds *even if the resolver key
   is compromised or the runner is buggy* — the highest-stakes automation in the
   system deserves one. It closes ADR 0008's open on-chain-gating item and must
   be plumbed from pregrad metadata through `CompleteSetPostgradAdapter` into the
   child market's constructor at graduation (a protocol slice, human-reviewed per
   the funds-holding-contract rule).
5. **Operator delay/override (§9).** Unchanged — the 24h Arc window still sits on
   top of a confident, in-window verdict.

Layers 1–3 and 5 are off-chain and land with this vertical; layer 4 is a small,
separate protocol PR (§14, slice 0).

## 4. Architecture — parallels to AI review

| Concern | AI review (existing) | AI resolution (this doc) |
| --- | --- | --- |
| Service dir | `server/src/ai-review/` | `server/src/ai-resolution/` |
| Runner dir | `server/src/ai-review-runner/` | `server/src/ai-resolution-runner/` |
| HTTP route | `POST /reviews/market` | `POST /resolutions/market` |
| Provider registry | `providers/registry.ts` (`satisfies Record<Name,Provider>`) | same shape, resolution providers |
| Untrusted-output guard | `response-parsing.ts` | clone: `resolution-parsing.ts` |
| Evidence fetch | `safe-web.ts` / `evidence.ts` | **reuse `safe-web.ts` as-is** |
| Audit table | `market_ai_reviews` | `market_resolutions` |
| Queue table | `market_ai_review_jobs` | `market_resolution_jobs` |
| Claim | `FOR UPDATE SKIP LOCKED` + partial-unique active index | identical |
| On-chain guarded transition | `chain-review.ts` (`approve`/`reject`) | `chain-resolution.ts` (`resolve`/`cancel`) |
| Signing key | `readReviewManagerPrivateKey` | `readResolverPrivateKey` |
| Admin path | `admin-review.ts` (`POST /admin/.../review`) | `admin-resolution.ts` (`POST /admin/.../resolution`) |
| Smoke | `ai-review-runner/smoke.ts` | `ai-resolution-runner/smoke.ts` |
| Orchestration | `review-service` + `review-runner` | `resolution-service` + `resolution-runner` |

The durable seams to clone verbatim (per the review map): the provider registry
`satisfies` pattern, the `response-parsing` "model output is never trusted"
discipline, the lease columns (`lease_until`/`locked_by`) + skip-locked claim +
partial-unique active-job index, the guarded on-chain transition (read contract
status → act only from the expected state → guarded SQL `UPDATE ... WHERE`), and
the append-only-audit vs mutable-queue two-table split.

## 5. Verdict contract

```ts
// server/src/ai-resolution/types.ts
type ResolutionOutcome = "yes" | "no" | "draw" | "too_early" | "abstain";
type ResolutionVerdict =
  | "resolve_yes" | "resolve_no" | "cancel_draw" | "requeue_too_early" | "manual_review";

interface ResolutionResult {
  outcome: ResolutionOutcome;      // model/heuristic determination
  verdict: ResolutionVerdict;      // derived: outcome+confidence → action
  confidence: number;              // 0..1
  reasons: string[];               // human-readable justification
  evidence: EvidenceItem[];        // reuse the review EvidenceItem shape
  sourceChecks: SourceCheck[];     // reuse; invented sources dropped by the parser
  hardFlags: string[];             // e.g. "sources_disagree", "deadline_ambiguous"
}
```

Derivation (the safety gate): a verdict becomes an **automatic** on-chain action
only when `outcome ∈ {yes,no}` **and** `confidence ≥ ABSTENTION_THRESHOLD`
(0.85) **and** at least one corroborating evidence item survived the parser.
A `draw` outcome **always parks** for an operator regardless of confidence —
draws are rare and high-blast-radius (both sides redeem at half), so `cancel()`
is only ever issued through the operator override / self-resolve path, never
auto-submitted. A `too_early` outcome **re-queues with backoff** (bump
`run_after`) — it is neither a failure nor a resolution; the event simply has not
concluded. `outcome === "abstain"`, low confidence, and no-evidence all park as
`manual_review` (persisted, no on-chain write). As in review, a service/model
error **fail-safe downgrades to `manual_review`** — an outage never resolves a
market. All of this sits behind the deterministic time gates (Temporal validity
guardrails): the runner never even calls the model before a market's per-outcome
`*_not_before`.

## 6. Data model

Mirror the review tables one-to-one. New Drizzle files under
`server/src/db/schema/`, new migrations after the current head.

**Temporal metadata (new columns on `market_metadata`).** `no_not_before`
(timestamp, required — backfilled from the existing `resolution_time`),
`yes_not_before` (timestamp, nullable, default = `no_not_before`),
`observation_window_start` / `observation_window_end` (timestamp, nullable). These
are immutable per market, set at creation, validated by AI review, and read by the
runner's deterministic gate (see Temporal validity guardrails). They flow into the
API market models (ADR 0009) and the create form (ADR 0013).

**`market_resolutions`** (append-only audit) — mirrors `market_ai_reviews`:
`id`, `chain_id`, `market_id`, `metadata_hash`, `postgrad_market_address`
(the child `CompleteSetBinaryMarket`), `provider`, `model_id`, `prompt_version`,
`outcome`, `verdict`, `confidence`, `reasons jsonb`, `evidence jsonb`,
`source_checks jsonb`, `hard_flags jsonb`, `resolved_at`, `created_at`. New
enums `resolution_outcome`, `resolution_verdict`, reuse `ai_review_provider`.

**`market_resolution_jobs`** (leased queue) — mirrors `market_ai_review_jobs`
exactly, including `lease_until`, `locked_by`, `attempt_count`, `max_attempts`,
`run_after`, `priority`, `last_error`, `resolution_id` FK, and the **partial
unique active-job index** on `(chain_id, market_id, metadata_hash) WHERE status
IN ('queued','running','retryable_failed')`. Add one column the review queue
doesn't need: `not_before` = the market's `yes_not_before` (the earliest the
market could legitimately resolve *at all* — a job is not enqueued/claimable
before it; the runner then applies the per-outcome gate when mapping the verdict,
§7). New enums `resolution_job_status`, `resolution_job_trigger`.

## 7. Runner lifecycle

Clone `ai-review-runner/index.ts`'s `while (!stopRequested)` loop
(enqueue → claim → process → sleep, SIGINT/SIGTERM drains).

**Discovery / enqueue.** Select markets in status `graduated` whose
`yes_not_before <= now`, that have no active resolution job and no prior terminal
resolution, joined to metadata. This is the resolution analogue of
`enqueueEligibleMarketReviewJobs`; `yes_not_before <= now` is the earliest-any-
outcome gate (Temporal validity guardrails).

**Claim / lease.** Identical to review: single transaction, `FOR UPDATE SKIP
LOCKED`, bump `attempt_count`, set `lease_until = now + leaseMs`, `locked_by =
runnerId`, `status = 'running'`. Crashed-runner recovery is the same lease-expiry
reclaim.

**Process.** Build the request from metadata (`resolution_criteria`,
`resolution_sources`, `resolution_url`, the question text), call the service,
apply the per-outcome time gate, then map `verdict` → action:
- `resolve_yes` (confident, evidence-backed, `now ≥ yes_not_before`) /
  `resolve_no` (…, `now ≥ no_not_before`) → on-chain `resolve(side)`, withheld
  behind the delay window (§9). A YES/NO that arrives before its gate is treated
  as `too_early` (defensive — the enqueue gate should already prevent it).
- `requeue_too_early` → bump `run_after` and re-queue; no audit-terminal, no
  on-chain action.
- `cancel_draw` / `manual_review` → persist audit + park job as `succeeded` with
  no on-chain action. A parked draw carries a `cancel()` recommendation for the
  operator; `cancel()` is only ever submitted via the override / self-resolve
  path, never automatically.

**On-chain guarded transition** (`chain-resolution.ts`, mirrors
`chain-review.ts`): read the child market's contract status; if already
`Resolved`/`Cancelled` return `already_transitioned`; else require `Trading`
before writing; submit with the resolver key; wait for receipt. Then persist:
append to `market_resolutions`, mark the job `succeeded`.

**Status propagation** is **not** done by a guarded `markets` UPDATE in the
runner (unlike review). Because a market can also reach `Resolved`/`Cancelled`
via the operator override or a trusted-creator self-resolve (§11), the canonical
projector is the **indexer**: a new `MarketResolved`/`MarketCancelled` watcher
flips `markets.status → resolved` (ADR 0010's open item). The runner writes the
verdict/audit; the chain event is the single source of truth for status. This is
a deliberate divergence from review, justified by resolution having multiple
actors.

**Retry/backoff/terminal failure**: reuse `failures.ts` unchanged in shape
(exponential backoff capped at 30 min, `terminal_failed` at `max_attempts`).

## 8. Providers

Clone the registry (`heuristic` / `ollama` / `anthropic`) via `satisfies
Record<ResolutionProviderName, ResolutionProvider>`. The heuristic provider makes
resolution deterministic for tests and the local stack (it reads a
known-outcome hint from seeded metadata). Evidence gathering reuses `safe-web.ts`
untouched. A new policy/prompt pair (`resolution-policy.ts`) states the outcome
rules and the JSON output contract; the untrusted-output parser
(`resolution-parsing.ts`) clones the review discipline (tolerant JSON parse,
unknown outcome → abstain, invented sources dropped, confidence clamped).

## 9. Safety valves

1. **Abstention threshold** (`RESOLUTION_ABSTENTION_THRESHOLD`, env-configurable).
   Set to **0.85**; below it, verdicts park in `manual_review`, and a market is
   never auto-resolved with zero surviving evidence.
2. **Operator delay/override window** (`RESOLUTION_DELAY_MS`). A confident verdict
   is persisted, but the on-chain `resolve` is withheld until `resolved_at +
   RESOLUTION_DELAY_MS`, during which an operator can override or cancel it.
   Implemented with the queue's `run_after`: on a confident verdict the runner
   persists the audit and re-queues the *submission* step with `run_after = now +
   delay`, rather than submitting inline. Set to **0 on `local`** (tests need
   immediacy) and **24h on Arc Testnet**.

These are the only safety valves on testnet, and both are conservative by
default, per ADR 0012. Draws bypass the auto path entirely (§5).

## 10. Resolver key custody

`readResolverPrivateKey(env, networkName)` mirrors
`readReviewManagerPrivateKey`: precedence `POPCHARTS_RESOLVER_PRIVATE_KEY` →
devchain/deployer fallbacks (local only) → validated 32-byte hex, never logged,
rotatable without schema change. It is a **distinct key** from the review
manager: the resolver address is fixed on the adapter at deploy time, and
resolution is the highest-stakes automation in the system, so its key should be
separately scoped and rotatable. Both keys are populated as secrets in ADR 0015.

## 11. `bypassAiResolution` / trusted-creator self-resolution

Today `bypassAiResolution` is enforced only at market **creation**
(`PregradManager.sol:957`: a public creator cannot set it; a trusted creator
can) and persisted through to `markets`/`market-events`. It has **no
resolution-time meaning yet** — that semantic is this vertical's to define, in
coordination with ADR 0008.

Proposed semantics: `bypassAiResolution === true` (only reachable by a trusted
creator) means the market is **not** auto-discovered by the resolution runner;
instead its outcome is submitted through an **operator-authenticated
self-resolve endpoint** (the creator/operator asserts the outcome, still audited
in `market_resolutions` with `provider = 'manual'`). `bypassAiResolution ===
false` (all public creators) means the market **must** go through the AI service
+ delay window. This keeps the resolver key on the operator side in both cases —
a trusted creator triggers a resolution, they don't hold the resolver key.

**Self-resolve is in the first build** (slice 5). Because shared operator auth
(ADR 0009/0011) does not exist yet, the self-resolve and override endpoints ship
behind a cloned env-flag gate (`POPCHARTS_ADMIN_RESOLUTION_ENABLED`) with a
single auth seam (an injectable `resolutionAdminEnabled()` dependency, mirroring
`admin-review.ts`), so swapping in real auth later is a one-point change, not a
rewrite.

## 12. Operator override, config, orchestration, smoke

**Override path** — `admin-resolution.ts` mirrors `admin-review.ts`: approve /
reject / replace a pending verdict, gated by the **shared operator auth** (ADR
0009/0011) once it exists; until then it clones the current env-flag gate
(`POPCHARTS_ADMIN_REVIEW_ENABLED`, or a sibling
`POPCHARTS_ADMIN_RESOLUTION_ENABLED`). Endpoint
`POST /admin/markets/:chainId/:marketId/resolution`.

**Config** — new `server/src/ai-resolution/config.ts`:
`AI_RESOLUTION_PROMPT_VERSION = "market-ai-resolution-v1"`, `AI_RESOLUTION_PROVIDER`,
`AI_RESOLUTION_INTERNET_ACCESS`, `AI_RESOLUTION_PORT` (propose 3004),
`RESOLUTION_ABSTENTION_THRESHOLD`, `RESOLUTION_DELAY_MS`, Anthropic/Ollama model
vars mirroring review. Runner config mirrors
`ai-review-runner/config.ts` (`AI_RESOLUTION_RUNNER_*`, `AI_RESOLUTION_SERVICE_URL`).

**Orchestration** — add `resolution-service` and `resolution-runner` to
`local-dev.control-plane.yaml` mirroring the two review processes (readiness
probe on `/ready`, `success_exit_codes: [130,143]`, env via new
`scripts/shared/aiResolution/` builders). This unblocks the ADR 0014 harness item
that currently has no resolution runner.

**Smoke** — `ai-resolution-runner/smoke.ts` mirrors the review smoke: seed a
`graduated` market past both `yes_not_before` and `no_not_before` with a
heuristic-known outcome, run one cycle, assert one job succeeded, an audit row
exists, and the child market reached `Resolved` on-chain (and, with the indexer
watcher, `markets.status = resolved`). A second seeded market before its
`no_not_before` asserts the deterministic gate parks a NO as `too_early`.

## 13. Decisions (resolved 2026-07-09)

1. **Abstention threshold — 0.85** + require ≥1 surviving evidence item. Below
   it, park for a human.
2. **Operator delay window — 24h on Arc Testnet, 0 on local.** Confident
   verdicts wait this long (overridable) before on-chain submission.
3. **Draws — always manual.** A `draw` verdict never auto-cancels; it always
   parks for an operator to confirm `cancel()`.
4. **Trusted-creator self-resolve — included in the first build** (slice 6),
   behind the cloned env-flag auth seam (§11), swappable to shared operator auth
   when it lands.
5. **Temporal validity guardrails — adopted.** Per-outcome `yes_not_before` /
   `no_not_before` gates + optional observation window in metadata; `too_early`
   model outcome; enforcement in creation/review, the runner's deterministic
   gate, and a minimal on-chain floor guard on `resolve` (not `cancel`). See the
   Temporal validity guardrails section.

## 14. Implementation slices (maps to the ADR 0012 checklist)

0. **On-chain floor guard (protocol, human-reviewed).** Immutable
   `earliestResolutionTime` on `CompleteSetBinaryMarket`; `resolve` reverts before
   it, `cancel` ungated; plumb the timestamp through `CompleteSetPostgradAdapter`
   from pregrad metadata at graduation. Closes ADR 0008's open on-chain-gating
   item. Touches a funds-holding contract → human review, not autonomous merge.
   Independent of the off-chain slices; can land in parallel.
1. **Schema + temporal metadata** — `market_resolutions` +
   `market_resolution_jobs` + migrations, and the `yes_not_before` /
   `no_not_before` / observation-window columns on `market_metadata`.
2. **Creation + review guardrails** — capture the temporal fields in the create
   flow (ADR 0013) and enforce clear expiry/source/timing in the review policy
   (ADR 0011), so malformed markets never reach the resolver.
3. **Service** — provider registry, policy/prompt (incl. the `too_early`
   outcome), `resolution-parsing`, `POST /resolutions/market`, reuse `safe-web`.
4. **Runner** — discovery (`yes_not_before` gate) + claim/lease + per-outcome
   time gate + `chain-resolution` guarded submission + delay-window re-queue +
   `too_early` re-queue.
5. **Indexer watcher** — `MarketResolved`/`MarketCancelled` → `markets.status`
   (coordinated with ADR 0010).
6. **Operator override + trusted-creator self-resolve** — `admin-resolution`
   (approve/reject/replace a pending verdict) and the self-resolve endpoint for
   `bypassAiResolution` markets, both behind the cloned env-flag auth seam (§11).
7. **Orchestration + smoke** — control-plane processes, env builders, heuristic
   smoke; extend the E2E lifecycle (ADR 0014) through resolution + redemption.

Each slice is a PR that ticks its ADR 0012 box in the same PR (per the ADR 0007
process). Critical path is 1 → 3 → 4 (schema, service, runner), which can be
proven end to end against seeded temporal metadata before slice 2 wires the
create form. Slice 0 (on-chain guard) runs in parallel on the protocol side;
slice 5 unblocks the app's resolved/redeem views; slice 6 ships behind the
env-flag auth seam and swaps to shared operator auth (ADR 0009/0011) when it
lands.
