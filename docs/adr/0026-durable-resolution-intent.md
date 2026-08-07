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
   to submit — point the job's `resolution_id` at it, and commit. One
   transaction, before any chain call.
2. **Runner proposes.** `proposeResolution(side)` on the market contract.
3. **Runner completes the job.** Mark `market_resolution_jobs.status =
   'succeeded'`. A second transaction, and deliberately not merged with
   anything else.
4. **Indexer confirms.** The existing `ResolutionProposed` watcher sets
   `commit_state = 'confirmed'` and stamps `resolved_at` from the block,
   taking the side from the event.

The runner never writes the confirmation. Status propagation is already the
indexer's job in this codebase, deliberately, because the operator override and
creator self-resolve paths also move markets — the same reasoning applies to
confirming a resolution.

### The job row and the audit row now mean different things

`market_resolutions` is what was decided. `market_resolution_jobs` is the work
of deciding it — the lease, the attempt count, the backoff. Today they complete
in one transaction; splitting the resolution write ends that, so the two states
become independent and each keeps its own meaning:

- `job.status = 'succeeded'` — the runner did its work and submitted.
- `commit_state = 'confirmed'` — the chain acknowledged it.

Neither waits on the other, and the indexer never touches the job row.

### The runner does not pre-check the chain

Step 2 calls `proposeResolution` without first asking the contract whether a
proposal already stands. It cannot need to: `proposeResolution` opens with
`_requireStatus(Status.Trading)` and reverts `InvalidStatus(actual, expected)`
otherwise. A second proposal is impossible, and the refusal is a typed custom
error the runner can decode exactly rather than guess at. viem simulates before
sending, so the revert surfaces at simulation and costs no gas.

So a retry that resumes a `pending` row simply proposes again:

- Success → step 3.
- `InvalidStatus(ResolutionPending, Trading)` → the proposal already exists.
  The runner's work is done; complete the job and leave `commit_state` alone,
  because confirming it is the indexer's transition.
- Anything else → a real failure; retry with backoff.

A cheap skip comes free: if the row is already `confirmed`, there is nothing to
do at all.

This removes the `already_on_chain` pre-check the earlier PRs were built
around. It was defensive code duplicating a guarantee the contract already
gives, and it read the chain to predict an outcome the chain reports anyway.

### Where a crash leaves things

Every gap in the sequence resolves without special handling:

| Crash point | State left behind | How it resolves |
| --- | --- | --- |
| Before step 1 | Nothing | Job retries from scratch. |
| Between 1 and 2 | `pending` row, job active | Retry adopts the row, proposes. |
| Between 2 and 3 | `pending` row, proposal on-chain | Retry adopts the row, proposes, gets `InvalidStatus`, completes the job. Indexer confirms. |
| After 3, indexer down | `pending` row, job succeeded | Indexer confirms when it catches up. |

The only residue is a row whose transaction never landed at all, covered below.

### What this removes

- **No model re-run.** A retry finds its own `pending` row and resumes from the
  verdict already recorded. It does not re-derive one.
- **No verdict divergence.** With no second judgment there is nothing to
  disagree with. The confirmed side comes from the event, so the row cannot
  contradict the chain by construction rather than by reconciliation.
- **No rescue path.** The row is never missing, so nothing needs to
  reconstruct it — and nothing forms a new AI opinion on a market that has
  already gone to a human.

### Rows whose transaction never landed

One case survives the three steps: the runner committed a `pending` row and the
transaction never landed — RPC failure, a revert, a nonce collision, or the
process dying in between.

**The correctness of that case is carried by the enqueue guard below, not by a
sweep.** Once `noResolutionForCurrentMarket()` counts only `confirmed` rows, a
`pending` row does not block its market. The market re-enqueues, the retry
adopts the existing row (the partial unique index guarantees there is only one),
and it tries again. The path self-heals without anything reading the chain.

What remains unhandled is cosmetic and operational: the row sits at `pending`
indefinitely, and nobody is told. Phase 5 makes that visible to operators; no
automated pass is being built. An earlier draft of this ADR asserted a sweep was
necessary, and that assertion did not survive being checked.

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

### The earlier PRs are all closed

PRs #499, #500 and #495 are closed. Nothing from that stack is being carried
forward, and this ADR should be read as replacing it rather than building on it.

- **#495** wrote the missing row on the stand-down path. Subsumed: the row is
  never missing. It also re-ran the model on a market already under human
  adjudication and filed that fresh opinion as the audit record for a proposal
  it did not make — reviewed as the wrong thing to do at all, not merely
  redundant.
- **#500** reconciled the row's verdict against `proposedSide()`. Subsumed:
  it existed because the retry re-ran the model, and the retry no longer does.
- **#499** supplied the chain reads the other two needed. Three of its four
  exports served only them; the fourth, `readOnChainResolutionProposal`, is
  broader than a sweep would need and belongs with the sweep if that survives.

The one thing #495 did that nothing here replaces is repairing markets that have
already lost their row. That is deferred, deliberately, and belongs in a
provenance-checking one-off rather than in the runner.

## Progress

Phase 1 — schema (generated output first, per `AGENTS.md`):

- [ ] `resolution_commit_state` enum with **two** values, `pending` and
      `confirmed`, and `market_resolutions.commit_state` defaulting to
      `confirmed` so existing rows and non-runner writers need no migration.
      `abandoned` is deliberately absent: nothing writes it unless Phase 6
      happens, and `ALTER TYPE ... ADD VALUE` is cheap when it does.
- [ ] `resolved_at` becomes nullable — a `pending` row has no block timestamp,
      and inventing one is the inference the paper-trail invariant forbids.
- [ ] Partial unique index: at most one `pending` row per market metadata
      version, mirroring the active-job index on `market_resolution_jobs`.
- [ ] Drizzle snapshot + migration; this PR carries only the schema file.

Phase 2 — the existence guard (before anything can write a `pending` row):

- [ ] `noResolutionForCurrentMarket()` counts only `confirmed` rows.
- [ ] Re-enumerate every other reader of `market_resolutions` at that commit.

Phase 3 — runner writes before it acts:

- [ ] Insert the `pending` row and point `job.resolution_id` at it, in one
      transaction, then call `proposeMarketResolutionOnChain`, then mark the
      job succeeded in a second transaction.
- [ ] A retry adopts its existing `pending` row and resumes from the recorded
      verdict. It must not call the resolution service again.
- [ ] Delete the `already_on_chain` pre-check. Decode
      `InvalidStatus(actual, expected)` from the revert instead and treat it as
      "already proposed, work done" — complete the job, leave `commit_state` to
      the indexer.
- [ ] Skip entirely when the adopted row is already `confirmed`.
- [ ] Non-submitting verdicts (`manual_review`, `cancel_draw`) write
      `confirmed` directly — nothing irreversible follows, so there is nothing
      to protect against.

Phase 4 — indexer confirms:

- [ ] The `ResolutionProposed` handler sets `commit_state = 'confirmed'` and
      `resolved_at` from the block, taking the side from the event.
- [ ] An event with no matching `pending` row is the operator or self-resolve
      path; it writes its own row as today and must not be treated as an error.
- [ ] Confirmation is idempotent under replay, per the existing indexer rules.

Phase 5 — visibility:

- [ ] Surface `pending` rows and their age to operators. This is the cheap half
      of the sweep question: if operators can see stuck rows, an automated
      sweep may never be needed. **Home amended at implementation time:** this
      phase originally said "in the postgrad admin CLI", but that CLI is in the
      protocol workspace and chain-only, and protocol must not import server
      code — pending rows are a server-DB fact. The lens is a server script
      (`server/scripts/resolution-pending-status.ts`, package script
      `resolution:pending`); the protocol CLI stays the chain-side lens.
- [ ] Update `docs/ai-resolution-service-design.md`, which still describes the
      runner writing its audit row only after a successful chain call.

Phase 6 — a reconciliation pass, only if Phase 5 shows it is needed:

- [ ] Decide the open question below first. Do not build this speculatively.
- [ ] If built, it belongs in the indexer service as a periodic pass, not on
      the runner's poll loop, and any abandon is a compare-and-set on
      `commit_state = 'pending'`.

## Settled: no reconciliation pass for now

**Decision (2026-08-06): option 1 — do nothing beyond Phase 5 visibility.**
Revisit with evidence from a running system rather than in advance.

A `pending` row whose transaction never landed is already harmless: the enqueue
guard ignores it, the market re-enqueues, and the retry adopts the row. What is
missing is that the row stays `pending` forever and nobody is notified — which
Phase 5's admin-CLI surface makes visible without any automation.

The three options, kept on record because the trade moves if rows turn out to
stick often:

1. **Nothing.** Operators see stuck rows in the admin CLI (Phase 5). A row
   pending for hours is a symptom of an unhealthy indexer or resolver key, both
   of which have their own alarms.
2. **Time-based cleanup, no chain read.** Mark rows `abandoned` after a
   threshold with no active job. Simple, but the threshold is a guess about
   maximum indexer lag, and guessing it wrong mislabels a row whose proposal
   did land.
3. **Chain-reading sweep.** Ask the contract whether a proposal exists before
   abandoning. Correct, and the only option that cannot mislabel — but it
   reintroduces a chain-reading dependency for a case the enqueue guard already
   renders harmless.

Note why option 2's threshold is the crux: the database cannot answer this
question about itself. Every DB fact about whether the proposal landed —
`markets.status`, the indexed resolution events — is written by the same indexer
whose staleness is in question. That is what pushes option 3 toward a chain
read, and it is also why option 1 is attractive: a question the system cannot
answer internally may be better escalated to a human than guessed at.

**Where it would live, if built: the indexer service, not the runner.** An
earlier draft put the sweep on the runner's poll loop. Wrong home. The indexer
already owns chain reads, RPC failover, and the parkable-error discipline, and
"make the database agree with the chain" is its job — the runner's is deciding
verdicts. It also keeps both `commit_state` transitions in one service.

Two things that placement does *not* do, worth stating so nobody assumes them:

- It cannot be event-driven. The failure being detected is that **no event was
  ever emitted**, so no watcher can fire. This would be a periodic pass over
  rows, which is a new shape for a service that today runs watchers plus a
  health interval. Not free.
- It does not on its own fix the race where the sweep reads "no proposal", the
  transaction lands, the indexer confirms, and the sweep then overwrites
  `confirmed` with `abandoned`. Any abandon must be a compare-and-set on
  `commit_state = 'pending'`, wherever the code lives. Co-locating only shrinks
  the surface.

Decided as above: ship Phases 1–5 and revisit only with evidence about how
often rows actually stick.

## Consequences

The runner does one extra database round trip before the chain write, on a path
already dominated by a model call and a transaction confirmation.

Confirmation now depends on the indexer, and nothing else may write that
transition — one writer, so a replayed or out-of-order event cannot race a
second source. A stalled indexer leaves rows `pending` longer, which is visible
rather than silent, and indexer health is already alarmed independently.

`abandoned` is a weaker signal than it first appears, and may not be needed at
all. `market_resolution_jobs` already records failure-to-act through
`last_error` and `terminal_failed`. What this ordering adds is that the
*judgment* survives, which the job row does not carry. That is the whole
justification, and it is why the ordering — not any status value — is the
decision.

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
