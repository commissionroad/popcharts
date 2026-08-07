# ADR 0026: Durable Resolution Intent

Status: Proposed

Date: 2026-08-06

## Context

The AI resolution runner submits an irreversible on-chain transaction and then
writes the record of why. That ordering is the defect. It is not a race that
needs tightening; it is the wrong order.

```
model → verdict          in process memory only
proposeResolution(side)  irreversible, permanent
insert market_resolutions ← if this throws, the reasoning is gone
```

Everything downstream follows from it. When the insert failed, the market was
left carrying a permanent proposal that nothing explained, and the job's retry
had no verdict to resume from — the model's output had died with the exception.
The retry therefore re-ran the model from scratch, which introduced a second
defect: the re-run can reach a different answer than the attempt that actually
proposed, so the audit row could record `resolve_no` while the chain finalized
YES.

A whole-file review of the ADR 0024 runner chain found both. An earlier
iteration of this work (PRs #500 and #495, now closed) patched each symptom:
reconcile the verdict against `proposedSide()`, and write the missing row on the
way out when the market has moved to `disputed` or `resolved`. Both worked.
Neither addressed the ordering, and the second had a flaw of its own — it re-ran
the model on a market already under human adjudication and filed that fresh
opinion as the audit record for a proposal it did not make.

### Why the order ended up this way

The repository's money paper-trail invariant requires records "sourced from an
on-chain event — never inferred, never dropped". That was applied as *do not
write until the chain confirms*, which produces exactly this ordering.

The invariant is about not inventing facts, not about when the write happens. A
row marked `pending` asserts that the runner decided something, not that
anything happened on-chain; the confirmation still arrives from the indexed
event. The transactional-outbox ordering satisfies the invariant. The current
ordering satisfies a misreading of it.

## Decision

Adopt the transactional-outbox ordering: record the intent durably, act, and let
the indexer confirm from the event it already watches.

1. **Runner writes intent.** Insert `market_resolutions` with
   `commit_state = 'pending'` — full model judgment and the verdict it intends
   to submit — and commit, before any chain call.
2. **Runner proposes.** `proposeResolution(side)` on the market contract.
3. **Indexer confirms.** The existing `ResolutionProposed` watcher sets
   `commit_state = 'confirmed'` and stamps `resolved_at` from the block,
   taking the side from the event.

The runner never writes the confirmation. Status propagation is already the
indexer's job in this codebase, deliberately, because the operator override and
creator self-resolve paths also move markets — the same reasoning applies to
confirming a resolution.

### What this removes

- **No model re-run.** A retry finds its own `pending` row and resumes from the
  verdict already recorded. It does not re-derive one.
- **No verdict divergence.** With no second judgment there is nothing to
  disagree with. The confirmed side comes from the event, so the row cannot
  contradict the chain by construction rather than by reconciliation.
- **No rescue path.** The row is never missing, so nothing needs to
  reconstruct it — and nothing forms a new AI opinion on a market that has
  already gone to a human.

### The sweep

One case remains, and it is the only thing the sweep exists for: the runner
committed a `pending` row and the transaction never landed — RPC failure, a
revert, a nonce collision, or the process dying between the two steps.

A sweep over `pending` rows older than a threshold reads the contract:

- A proposal stands → leave it alone. The indexer will confirm it, or has
  already; the sweep does not race the watcher for the same write.
- No proposal, and the owning job is no longer active → set
  `commit_state = 'abandoned'`. The market becomes enqueueable again, and the
  judgment that was never acted on stays on file.

### The guard that must land first

**`noResolutionForCurrentMarket()` must count only `confirmed` rows, and that
must be in place before anything can write a `pending` one.** It gates
re-enqueue, so a `pending` row from a failed propose would otherwise strand its
market permanently — the exact failure this ADR exists to remove. It gets its
own phase for that reason.

Re-enumerate the other readers at implementation time rather than trusting a
count in this document: it was one when this ADR was drafted, and two by the
time PR #495 was written (its `hasPersistedResolution()` made the same
existence-implies-completion assumption). PR #495 is closed, so that second
reader goes with it, but the lesson is that the count moves.

### Storage: a state column, not a second table

`commit_state` lives on `market_resolutions`. An earlier draft proposed a
separate `market_resolution_intents` table so that a row in `market_resolutions`
would keep meaning "this happened on-chain".

Rejected. It buys exactly one thing — readers never filter — while needing the
same states, the same sweep, and the same terminal `abandoned`, plus a foreign
key and a duplicated JSONB payload. Measured rather than assumed: the readers
gating on row existence are runner-local and countable on one hand, and no
operator UI, export, or API endpoint reads this table. Revisit if that changes.

The cost is real and stated plainly: `market_resolutions` no longer means "this
happened on-chain" on its own, and it is no longer strictly append-only — a row
transitions once, forward. Defaulting `commit_state` to `confirmed` keeps every
existing row and every non-runner writer (manual override, creator
self-resolve) correct with no data migration.

### Relationship to PR #499

Keep it; land it independently. It adds `readOnChainResolutionProposal`, which
is what the sweep uses to ask whether a proposal exists and for which side. It
changes no behaviour on its own.

PRs #500 and #495 are closed as superseded.

## Progress

Phase 1 — schema (generated output first, per `AGENTS.md`):

- [ ] `resolution_commit_state` enum (`pending` / `confirmed` / `abandoned`) and
      `market_resolutions.commit_state`, defaulting to `confirmed` so existing
      rows and non-runner writers need no migration.
- [ ] `resolved_at` becomes nullable — a `pending` row has no block timestamp,
      and inventing one is the inference the paper-trail invariant forbids.
- [ ] Partial unique index: at most one `pending` row per market metadata
      version, mirroring the active-job index on `market_resolution_jobs`.
- [ ] Drizzle snapshot + migration; this PR carries only the schema file.

Phase 2 — the existence guard (before anything can write a `pending` row):

- [ ] `noResolutionForCurrentMarket()` counts only `confirmed` rows.
- [ ] Re-enumerate every other reader of `market_resolutions` at that commit.

Phase 3 — runner writes before it acts:

- [ ] Insert the `pending` row, commit, then call
      `proposeMarketResolutionOnChain`.
- [ ] A retry adopts its existing `pending` row and resumes from the recorded
      verdict. It must not call the resolution service again.
- [ ] Non-submitting verdicts (`manual_review`, `cancel_draw`) write
      `confirmed` directly — nothing irreversible follows, so there is nothing
      to protect against.

Phase 4 — indexer confirms:

- [ ] The `ResolutionProposed` handler sets `commit_state = 'confirmed'` and
      `resolved_at` from the block, taking the side from the event.
- [ ] An event with no matching `pending` row is the operator or self-resolve
      path; it writes its own row as today and must not be treated as an error.
- [ ] Confirmation is idempotent under replay, per the existing indexer rules.

Phase 5 — sweep and visibility:

- [ ] Sweep stale `pending` rows on the existing runner poll loop: leave rows
      whose proposal stands, abandon those with none and no active job.
- [ ] Operator alert on abandon, and surface `pending` / `abandoned` rows in
      the postgrad admin CLI beside the existing dispute actions.
- [ ] Update `docs/ai-resolution-service-design.md`, which still describes the
      runner writing its audit row only after a successful chain call.

## Consequences

The runner does one extra database round trip before the chain write, on a path
already dominated by a model call and a transaction confirmation.

Confirmation now depends on the indexer. A stalled indexer leaves rows `pending`
longer, which is visible and already alarmed rather than silent — and the sweep
deliberately does not confirm on the indexer's behalf, so there is one writer
for that transition.

`abandoned` is a weaker signal than it first appears: `market_resolution_jobs`
already records failure-to-act through `last_error` and `terminal_failed`. What
this ordering adds is that the *judgment* survives, which the job row does not
carry. That is the whole justification, and it is why the ordering — not the
status value — is the decision.

This does not fix the lease-expiry race. The job update matches on `id` rather
than lease owner, so a worker outliving its lease can still double-write. The
partial unique index narrows it.

## Deferred

- **Backfill of already-lost rows.** Markets that lost their audit row before
  this ships still have none. A repair tool must establish provenance first — a
  creator self-resolve or operator action must never be recorded as an AI
  verdict. This is the one job the closed PR #495 was doing that nothing else
  now covers, and it belongs in a deliberate one-off, not in the runner.
- **Splitting unconfirmed judgments into their own table.** Rejected above. The
  trigger to revisit is `market_resolutions` gaining readers outside the runner.
- **Lease-aware job completion.** Match the job update on lease owner and
  status, not `id` alone.
