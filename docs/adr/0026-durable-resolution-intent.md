# ADR 0026: Durable Resolution Intent

Status: Proposed

Date: 2026-08-06

## Context

The AI resolution runner performs two writes that cannot be made atomic: an
on-chain `proposeResolution` transaction and a `market_resolutions` insert.
There is no transaction spanning Postgres and the chain, so a crash, a
transient database error, or a process kill between the two leaves them
disagreeing. Reordering them does not remove the failure — it only chooses
which side is left holding an unmatched write.

Today the chain goes first. A whole-file review of the ADR 0024 runner chain
found the consequence: the runner proposed on-chain, the persist threw, the job
went `retryable_failed`, and a disputer moved the market to `disputed` before
the retry landed. `disputed` is excluded from `RUNNER_ELIGIBLE_MARKET_STATUSES`,
so the retry cancelled the job, and the enqueue query excludes `disputed` too,
so nothing ever picked that market up again. The proposal stayed on-chain
permanently and no row was ever written. The reasoning behind a verdict was
missing at exactly the moment an operator needed it — while adjudicating the
dispute against that verdict.

PRs #499/#500/#495 close that hole by making the loss *recoverable*: the
runner reads `proposedSide()` back off the contract and writes the audit row on
the stand-down path. That works because the chain is readable after the fact.
It does not change the ordering, so two gaps remain:

1. If every retry attempt fails, the job reaches `terminal_failed` and the row
   is still never written.
2. The model's reasoning for the attempt that actually proposed is gone the
   moment its process dies. The rescue re-runs the model and records a *later*
   judgment, correctly labelled, but it is not the judgment that was acted on.

The second gap is the one that matters for adjudication. Reasoning that only
exists in memory during an irreversible act is not an audit trail.

### Why not simply write the database row first

Considered and rejected as stated. A row in `market_resolutions` currently
means "this resolution happened". Writing it before the transaction inverts
that: the row becomes a prediction that may be false, which breaks the
`AGENTS.md` money paper-trail invariant ("sourced from an on-chain event —
never inferred"). It is also strictly worse operationally. `market_resolutions`
gates re-enqueue through `noResolutionForCurrentMarket()`, so a row written
before a chain write that then failed permanently blocks that market from ever
being enqueued again. Losing the audit row is bad; leaving the market
unresolvable with a phantom verdict on file is worse.

## Decision

Write the judgment to `market_resolutions` **before** proposing, carrying a
`commit_state` that says whether the chain has confirmed it.

1. The runner inserts the row with `commit_state = 'pending'` and commits, before
   calling `proposeResolution`. The model's reasoning is durable at this point.
2. It proposes on-chain.
3. It sets `commit_state = 'confirmed'`, stamps `resolved_at` from the block, and
   completes the job — one transaction, as today.

A reconciliation sweep settles any row left `pending`, by reading the contract:

- The chain carries a proposal → confirm the row, taking the verdict from
  `proposedSide()`. The reasoning recorded is the reasoning that was acted on.
- The chain carries no proposal and the owning job is no longer active → set
  `commit_state = 'abandoned'`. The market becomes enqueueable again.

**`noResolutionForCurrentMarket()` must exclude non-confirmed rows, in the same
PR as the column.** This is the sharp edge of the whole design. That predicate
gates re-enqueue, so a `pending` row left behind by a failed propose would
otherwise block its market from ever being enqueued again — the exact permanent
stranding this ADR set out to avoid. The column without the query change is
worse than no column at all.

### What this gives up, and why that is acceptable

`market_resolutions` stops meaning "this happened on-chain" on its own. Readers
must filter on `commit_state`, and the table stops being strictly append-only —
a row transitions once, forward, from `pending` to a terminal state.

That is a real cost, and it is accepted because the exposure is small and
enumerable rather than hypothetical. **Two** production predicates gate on a row
existing, both inside the runner and both listed in Phase 2:
`noResolutionForCurrentMarket()` in the enqueue query, and
`hasPersistedResolution()` in the stand-down path that PR #495 adds. Every other
reader is a lifecycle-nightly scenario. There is no operator UI, export, or API
endpoint reading this table today. Designing around readers that do not exist is
speculation, and it is cheaper to filter two runner-local predicates than to
carry a second table, a foreign key, and a duplicated JSONB payload
indefinitely.

The count moved from one to two while this ADR was open, which is worth
recording: the argument for the column is "few, enumerable readers", and that is
a claim to re-check at implementation time rather than inherit from this
paragraph. If it reaches a handful, or any reader lands outside the runner,
re-open the rejected alternative below.

### The rejected alternative: a separate intents table

An earlier draft of this ADR proposed `market_resolution_intents` holding
unconfirmed judgments, with `market_resolutions` unchanged and a foreign key
between them. Rejected as unjustified for what it buys.

It buys exactly one thing the column does not: readers of `market_resolutions`
never need to filter. Everything else is identical — both need the same three
states, the same sweep, and the same `abandoned` terminal state, because both
must stop a never-confirmed judgment from blocking re-enqueue. The separation
costs a new table, a foreign key, a join for anyone who wants the reasoning
alongside the record, and a duplicated payload on commit.

Revisit this if `market_resolutions` grows readers outside the runner — an
operator console or a data export are the plausible triggers. At that point the
filtering discipline stops being one line in one query.

### On `abandoned` as an operational signal

The earlier draft claimed `abandoned` as a benefit. It is weaker than that.
`market_resolution_jobs` already records failure-to-act: `markResolutionJobFailure`
writes `last_error` and moves the job to `retryable_failed` or `terminal_failed`.
A runner that decided and then failed to submit is already visible there.

What `abandoned` adds is that the **judgment** survives alongside the failure,
which the job row does not carry. That — not the status value — is the entire
justification for writing before the chain call, and it holds identically in
both designs.

### Relationship to PRs #499/#500/#495

Complementary, not superseded. Land the open stack first.

- The chain read surface (#499) is what the sweep is built on.
- Verdict reconciliation (#500) stays necessary: any path that finds a proposal
  already standing must record the chain's side, not a later run's.
- The stand-down rescue (#495) stays as the backstop for markets with no
  `pending` row at all — rows lost before this ADR ships, and operator or
  creator self-resolve paths the runner never drove.

**One live interaction, not a conflict but close to one.** PR #495 introduces
`hasPersistedResolution()`, a second predicate that treats "a row exists" as
"nothing left to record". This ADR makes that inference false for `pending`
rows. Shipped in the wrong order — a `pending` row written before
`hasPersistedResolution()` learns to filter — the rescue would cancel the job
believing the audit row was already written, and the hole PR #495 closed would
reopen with no test failing. Phase 2 exists to make that unshippable, and it is
why Phase 2 precedes Phase 3 rather than riding along with it.

## Progress

Phase 1 — schema (generated output first, per `AGENTS.md`):

- [ ] `resolution_commit_state` enum (`pending` / `confirmed` / `abandoned`) and
      `market_resolutions.commit_state`, defaulting to `confirmed` so every
      existing row keeps its current meaning without a data migration.
- [ ] `resolved_at` becomes nullable: a `pending` row has no block timestamp
      yet, and inventing one would be the inference this ADR forbids.
- [ ] Partial unique index: at most one non-terminal row per market metadata
      version, mirroring the active-job index on `market_resolution_jobs`.
- [ ] Drizzle snapshot + migration. This PR carries only the schema file that
      produces them.

Phase 2 — the existence guards (before anything writes a `pending` row):

- [ ] `noResolutionForCurrentMarket()` counts only `confirmed` rows. Landing
      this ahead of Phase 3 means a `pending` row can never strand a market,
      whatever order the rest arrives in.
- [ ] `hasPersistedResolution()` (PR #495's stand-down path) counts only
      `confirmed` rows. Without this the two changes actively fight: a
      `pending` row would satisfy the "already has a row" check, so the rescue
      would cancel the job without recording anything and reintroduce exactly
      the hole PR #495 closed.
- [ ] Re-enumerate every other reader of `market_resolutions` at that commit
      rather than trusting the count in this ADR. It was one when the ADR was
      drafted and two by the time PR #495 was written.

Phase 3 — runner writes before it acts:

- [ ] `processResolutionJob` inserts the `pending` row before
      `proposeMarketResolutionOnChain`, then confirms it inside the existing
      `persistResolutionJobResult` transaction.
- [ ] A pre-existing `pending` row for the same market is adopted and updated,
      not duplicated, so a retry does not fan out rows.
- [ ] Non-submitting verdicts (`manual_review`, `cancel_draw`) write a
      `confirmed` row directly: nothing irreversible is about to happen, so
      there is nothing to protect against.

Phase 4 — reconciliation sweep:

- [ ] A sweep over `pending` rows older than a threshold, reading contract
      status and `proposedSide()`, confirming or abandoning each.
- [ ] Runs on the existing runner poll loop rather than a new process.
- [ ] Abandoning raises an operator alert. Not because the status is novel —
      the job row already carries the failure — but because it is the one place
      the abandoned *judgment* is visible.

Phase 5 — operator visibility and docs:

- [ ] Surface pending and abandoned rows in the postgrad admin CLI, beside the
      existing dispute actions.
- [ ] Update `docs/ai-resolution-service-design.md`, which still describes the
      runner writing its audit row only after a successful chain call.

## Consequences

The runner does one extra database round trip per submitting job, before the
chain write. That is the cost of the guarantee, and it is on the slowest path
in the system already — a model call and a transaction confirmation dominate it.

`market_resolutions` now holds rows for judgments that were never acted on, and
every reader must filter on `commit_state`. The default of `confirmed` means
existing rows and every non-runner writer — manual override, creator
self-resolve — keep working untouched, so the discipline applies only to code
that deliberately opts into the pending path.

The table is no longer strictly append-only. A row transitions once, forward,
from `pending` to `confirmed` or `abandoned`; the judgment columns themselves
are still never rewritten. Update the schema comment to say exactly that, since
the current one claims rows are never updated.

This does not fix the lease-expiry race. The job update matches on `id` rather
than lease owner, so a worker outliving its lease can still double-write. The
partial unique index narrows it but does not close it. Hardening the claim/lease
contract is separate work.

## Deferred

- **Backfill of already-lost rows.** Markets that lost their audit row before
  this ships still have none. A repair tool must establish provenance before
  attributing a proposal to the runner — a creator self-resolve or operator
  action must not be recorded as an AI verdict.
- **Splitting unconfirmed judgments into their own table.** Rejected above as
  unjustified today. The trigger to revisit is `market_resolutions` gaining
  readers outside the runner — an operator console or a data export — at which
  point the filtering discipline stops being one line in one query.
- **Lease-aware job completion.** Match the job update on lease owner and
  status, not `id` alone, and decide whether `market_resolutions` should carry
  a uniqueness constraint.
- **Lease-aware job completion.** Match the job update on lease owner and
  status, not `id` alone, and decide whether `market_resolutions` should carry
  a uniqueness constraint.
