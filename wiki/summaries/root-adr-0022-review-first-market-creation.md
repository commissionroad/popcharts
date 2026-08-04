---
type: summary
title: Repo ADR 0022 — Review-first market creation (off-chain drafts, gated publish, fee-on-accept)
description: Accepted inversion of market creation — questions live as off-chain editable Drafts reviewed before any chain write; on approval the creator publishes via a gated createMarket (authorizer signature, born Active) paying the fee at publish, not submit; plus templates, Privy-auth drafts, and a real-markets-only board. Drafts, draft review, the review bond and templates are built; the contract gate is not.
sources:
  - docs/adr/0022-review-first-market-creation.md
updated: 2026-08-04
---

# Repo ADR 0022: Review-first Market Creation

**Status: Accepted, partially built.** Dated 2026-07-21. Designed via a `/grill`
session and adversarially red-teamed before proposal. Not part of the M1–M5 launch
chain. P1 (drafts + Privy auth), P2 (draft review), P3/P3a (review credit) and P7
(templates/clone) landed 2026-08-03..04; **P4 landed in full 2026-08-04** — authorized
creation is live end to end (#430, #439/#441, #442, #445, #447, #448, #449) and
draft-flow markets are born `Active`. The interim ungated `createMarket` overload and
the now-no-op publish bridge remain as dead weight for P5, which is unblocked. P6 and
P8 are open.

> **P3 was withdrawn 2026-08-04** and replaced by the amendment: the refundable
> bond becomes a non-refundable **prepaid review credit**. See "Amendment: prepaid
> review credit" at the bottom of this page — the bond decision described below,
> and P3 in the phased plan, are superseded by P3a.

## Context

Today a market is created **on-chain first, then reviewed**:
[PregradManager](../entities/pregrad-manager.md) `createMarket` is `payable`,
collects the flat fee atomically, and records the market in `UnderReview`; the
[AI-review runner](../entities/ai-review-service.md) then calls `approveMarket`
(→ `Active`/`bootstrap`) or `rejectMarket` (→ `Rejected`). Three pains: a reject
is terminal and **burns the fee** (no refund path, no appeal — ADR 0019); there
is **no draft** to iterate on (a market row exists only after the `MarketCreated`
event); and the discovery board shows **every status**. This also reconciles a
standing doc contradiction — ADR 0013 promises "what to change before
resubmitting" copy while ADR 0019 says reject is terminal with no appeal.

## Decision

**Invert to review-first.** A question lives as an off-chain, editable **Draft**
during review and never touches the chain until approved. On approval the creator
**publishes** on-chain (paying the fee then) and only then is it a **Market**.
Rejected/in-progress drafts are free, editable, and private.

- **Off-chain `market_drafts` entity**, distinct from a Market. Content mirrors
  the `createMarket` params (deadlines stored as **relative durations**);
  bookkeeping adds owner (Privy user), `status`, `is_template`, `visibility`,
  `deleted` soft-delete, `published_market_id` back-link, latest-rejection
  pointer. Drafts **linger forever**; soft-delete to hide.
- **Two charges: creation fee (at publish) + review bond (at submit).** The
  existing creation fee stays fee-on-accept — paid at **publish** (`createMarket`),
  not submit; rejected/iterated drafts never pay it. Separately, a **prepaid
  refundable review bond** funds the AI-review pipeline and is the Sybil defence:
  a standing bond (min **$5**) into a **separate `ReviewBondVault` escrow
  contract**, drawn down by fees ($1/submission incl. 5 reviews, $0.20/review
  after), **no slashing**, withdraw the unused remainder anytime. Denominated in
  **native USDC via `msg.value`** (on Arc, USDC is the native token — no ERC-20
  `approve`; $1 = `1e18`). Fees are **metered off-chain** (submitting/iterating
  stay off-chain and free-feeling); only the bond **deposit / resolver-settlement /
  withdrawal** are on-chain events. This closes the paid-pipeline Sybil exposure
  the red-team flagged (rate limiting alone was not Sybil-resistant vs free
  embedded wallets); coarse rate limiting stays as a cheap first layer.
- **Creator publishes** (not a platform relay). The **publish authorization is
  minted at publish time, not cached from approval**: the server re-checks the
  draft is still approved + unchanged, resolves the relative durations into
  absolute deadlines then, and mints a short-lived single-use authorization —
  which is why a long-lingering approved draft stays publishable (no stale
  absolute deadline).
- **Gated `createMarket`** via an EIP-712 authorizer signature (owner-set key)
  over the **full final params** (not just `metadataHash`, which commits only the
  question text), with an **on-chain single-use nonce** + expiry. No valid
  signature → revert, so there is no direct-to-contract path that skips review.
  **Trusted creators bypass the signature entirely** (as they already bypass the
  fee) — the vetted-party path (none yet, but the mechanism must exist).
- **Markets born `Active`**; the on-chain review path retires
  (`UnderReview`/`approveMarket`/`rejectMarket`, the review-manager key, the
  indexer market-review watcher). The `MarketCreated` indexer projection must flip
  from `under_review` to `bootstrap`. This is a deliberate move from
  **permissionless creation + post-hoc review** to **permissioned creation gated
  by review**.
- **Metadata needs no contract change** — the full text is *already* emitted
  on-chain in `MarketCreated` and hash-committed; only a server cleanup (populate
  the display `market_metadata` from the event, drop the flaky off-chain POST).
- **Draft auth = Privy JWT** (verified server-side; EOA + SSO both work).
  **Templates** = universal clone (own drafts / own markets / any market by id) →
  new editing draft, verbatim copy; `is_template` shelf; `visibility` reserved for
  future sharing.
- **Public board = real markets only**; a separate creator surface shows
  drafts/templates/my markets (resolved via `published_market_id` + a normalized
  linked-wallet set). Filters: Pre-grad(`bootstrap`) / Graduating / Graduated /
  Resolving (derived from an in-flight resolution job; the Graduated filter
  anti-joins it out) / Resolved / Refunded / Cancelled.

## Draft review data model

The existing AI-review tables cannot be reused as-is: `market_ai_reviews` /
`market_ai_review_jobs` carry `marketId NOT NULL` and FKs to `markets` and
`market_metadata`, none of which exist until publish. Review-first needs
**draft-keyed review/job tables** and a **reworked runner** that enqueues from
`market_drafts` and applies verdicts as draft-state transitions (no on-chain
`approveMarket`/`rejectMarket`). Reused is the *pattern* — content-addressed
metadata (keyed to the draft's snapshot `metadataHash`; edit → new hash → fresh
review), the leased-job queue, and the stateless review service — not the tables.

## Red-team corrections folded in

An adversarial review (protocol/security, data-model/migration, product/economics,
money-invariant lenses) caught, before build: the money-trail claim was **false**
(`MarketCreationFeePaid` is emitted but **indexed nowhere** — a fee-indexing phase
was added and the fee added to [portfolio-data-design](portfolio-data-design.md));
the review tables are on-chain-market-bound (the data-model section above); absolute
deadlines went stale for lingering approved drafts (fixed via publish-time auth over
durations); the born-Active indexer projection flip was un-itemized; and the
Privy-user vs wallet-address identity join for "my published markets" was
unspecified. The red-team also flagged that removing the submission fee left the
paid AI-review pipeline Sybil-exposed under rate-limiting-only — now closed by the
prepaid review-bond escrow (decision above), which superseded the initial
rate-limiting-only stance.

## Phased build plan

Public draft submission opens at P3 (the bond); until then P2 review runs internally.

1. **P1 — built.** Draft entity + Privy-authenticated CRUD + "my drafts" surface.
2. **P2 — built.** Off-chain AI review on drafts (new draft-keyed tables + reworked runner) — keystone.
3. **P3 — built, then withdrawn; see P3a below.** `ReviewBondVault` escrow (native-USDC deposit/settle/withdraw) + off-chain fee meter ($5 min, $1/submit incl. 5 reviews, $0.20 after) gating submission + bond-event indexing. Replaced 2026-08-04 by **P3a — prepaid review credit** (built): non-refundable `depositFor`, one per-run rate, no settlement or withdrawal.
4. **P4 — built (2026-08-04).** Gated `createMarket` (full-params EIP-712, unordered single-use nonce, 15-min expiry, trusted bypass, born `Active`, #442); typed data exported from the protocol package with an on-chain vector test (#445); server mints the creator-bound authorization with the publish params (#447); local deploy arms the deployer as authorizer (#448); the app spends it and re-mints on expiry (#449). Plus the earlier halves: "Publish & pay" (#415), `MarketCreationFeePaid` indexing (#430), chain-read status projection with the `under_review` default dropped (#439/#441). First end-to-end authorized publish ran in #449's CI smoke lane.
5. **P5 — open, blocked on P4.** Retire on-chain review machinery + migrate legacy `under_review`/`rejected` rows (tail-only enum removal).
6. **P6 — open.** Populate `market_metadata` from the event; drop the off-chain POST.
7. **P7 — built.** Templates + clone (the `/studio` surface).
8. **P8 — open.** Server-side discovery filters (+ `markets.status`/timestamp indexes; Graduated anti-joins Resolving).

## What shipped differently from the design

Three notes the ADR now records, all from the 2026-08-03 build:

- **A third review outcome.** The designed state machine was
  `in_review → approved | rejected`; the build added **`changes_requested`**, which a
  `manual_review` verdict maps to. It separates *quality* feedback from *policy*
  rejection; both are editable and resubmittable, so the creator loop is unchanged.
- **Publish bridges over the ungated contract until P4.** The server calls
  `createMarket` (market still born `UnderReview`) and immediately force-approves with
  the review-manager key. The gate therefore lives in server code rather than in the
  signature check the design specifies — the reason P4 is the keystone of what remains,
  and why P5 cannot start (the review-manager key and the on-chain review states are
  both load-bearing for the bridge).
- **The bond's withdraw gate lags the meter.** `withdrawBond` allows
  `deposited - settledConsumed`, and `settledConsumed` only moves when the resolver
  settles, so between settlements a creator can withdraw against reviews already
  consumed. Bounded by the unsettled tally (~$1 at this price schedule) and accepted
  for v1.

## Consequences

Creation becomes **permissioned** (authorizer key = security-critical
infrastructure: custody, rotation, on-chain single-use nonce). A **new money
contract** appears — the `ReviewBondVault` escrow with an owner-set resolver that
settles off-chain-metered consumption on-chain (the off-chain meter becomes a
correctness-critical accounting surface). The creation fee finally gains an
event-sourced record (it had none). The AI-review runner + tables are reworked, not
re-pointed. Existing on-chain `under_review`/`rejected` markets need a migration; the
Postgres `market_status` enum can't drop a value in place and the on-chain enum
values must be removed only from the tail (server code hand-decodes `uint8`
ordinals). SSO users must fund their embedded wallet twice — the review bond before
submitting, the creation fee before publishing. Draft endpoints are the app's first
surface needing real authenticated writes.

## Amendment: prepaid review credit (2026-08-04)

P3 shipped as designed, and the shipped design was withdrawn. The escrow section
specified withdrawal "gated on settlement being current"; the shipped
`withdrawBond` was not, checking only the on-chain `settledConsumed` — a lagging
replica of the off-chain meter. Two defects followed from that one root (an
on-chain withdrawal path cannot see an off-chain meter): a creator could withdraw
money covering reviews already consumed (small — settlement fires at a $1
unsettled tally — but unbounded when settlement transactions fail), and
withdrawing decrements `deposited`, which makes `settle` revert forever once the
lifetime consumed total exceeds it, **wedging settlement for that wallet
permanently**.

Rather than close the gap (resolver-signed withdrawals, settle-before-withdraw, a
held-back floor), the withdrawal is removed:

- Deposits are **non-refundable**. There is no user withdrawal path. This is a
  **prepaid credit**, not a bond — the word "bond" is retired.
- **`depositFor(address beneficiary)`**, never `msg.sender`: with no way to move a
  balance afterwards, a creator holding both an embedded and an external wallet
  would otherwise be one mis-selection away from an unrecoverable payment. No
  owner-side reassignment function — a privileged "move user funds" call is a
  worse audit surface than the mistake it fixes.
- **One rate, one unit — the review run.** No bundling, no first-submission
  surcharge, no $5 minimum (a refundable floor only cost an attacker time-value;
  non-refundable money has more bite). Priced at spend time, with the rate in
  force stamped on each charge row.
- The rate is **provisionally $0.10/run and is configuration**. It is a testing
  rate *below cost* — a run measures $0.169 on the claude-cli provider — so it
  inverts the anti-spam incentive. **Public submission must not open at $0.10**;
  either the rate rises to $0.20+ or review moves to a cheaper provider.
- On-chain surface collapses to `depositFor` + `withdrawCollectedFees`. `settle`,
  `withdrawBond`, `setResolver`, the resolver key, and on-chain consumption
  tracking are deleted. The vault is deployed on local stacks only and appears in
  no infra/CI config, so this is a **rewrite, not a migration**.
- **Balance is read from the indexed DB, never a direct chain read** — the
  repo-wide direction (one source, served fast, client notified by the change
  feed). Safe by construction: charges are written synchronously while deposits
  lag, so staleness only makes a balance look *too low*. The deposit handler must
  call `recordLiveChange`, which it does not today.
- Coverage gap to close with it: the nightly lifecycle stack never deploys the
  vault, so the meter sees no address and waves every submission through — the
  whole payment path is untested end to end.

Phase plan below is superseded at P3: **P3a — prepaid review credit** replaces it.
**P3a delivered 2026-08-04** (#431 + the lifecycle-lane PR): vault rewritten to
`depositFor(beneficiary)` + owner sweep, one-way meter at a configurable per-run
rate over chain/vault-scoped indexed deposits, change-feed signal on deposit, and
the lifecycle lane running metered with the funded journey covered end to end. A
pre-publish review caught a concurrent-overspend race (fixed with a wallet-scoped
advisory lock), unscoped credit across deployments, and the migrations silently
reinterpreting refundable-bond history. The retired enum values stay (Postgres
cannot drop them in place); the app-side "notified" is a poll until the ADR 0021
SSE subscription lands.

## P4 build decisions (locked 2026-08-04)

The phase entry says what P4 does; a decisions section in the ADR now says how, on the
points that admitted more than one answer.

- **A new authorizer key, not the review-manager key** — otherwise P5's removal of that key
  is a rename, and its blast radius grows exactly when we are retiring it.
- **The authorization is bound to the creator's address** and carries an **unordered
  single-use nonce** — bearer signatures would be free markets if leaked; a per-creator
  counter would serialise a creator's drafts behind one failed transaction.
- **15-minute expiry.** Not an anti-theft measure (creator binding covers that): the
  authorization carries absolute deadlines resolved at mint time, so its lifetime is how far
  a market's dates can drift from what was reviewed. Partial staleness does not revert —
  `_validateCreateMarketParams` only rejects an already-past `graduationDeadline` — so a
  stale authorization ships a quietly shortened market. Requires the app to **re-mint on
  expiry** rather than error.
- **Rotation is a single owner setter**; a two-key overlap is not worth doubling the key
  code to protect a 15-minute retry window.
- **The on-chain review runner switches off the day P4 lands** — after the gate, nothing can
  create an `under_review` market, so it has nothing to sweep. Existing `under_review` /
  `rejected` rows are **testnet data and may be wiped**, which removes the enum-rewrite
  pressure from P5.
- **Small PRs split by workspace**, made safe by having the **indexer read a market's real
  on-chain status instead of hard-coding `under_review`** — correct under both the old and
  new contract, so it lands alone and dissolves the contract↔indexer coupling instead of
  sequencing around it. Order: fee receipts → indexer status read → contract → mint
  authorization → dev key wiring → app re-mint.

The creation-fee receipt work is **pulled ahead of the rest of P4**: it does not depend on
the gate, and until it lands the creation fee is the only value transfer in the system with
no receipt-linked record — a standing exception to the invariant in
[portfolio-data-design](portfolio-data-design.md).

## Related pages

- [../entities/pregrad-manager.md](../entities/pregrad-manager.md) — `createMarket` gains the authorizer-signature gate + born-Active; loses `approveMarket`/`rejectMarket`
- [../entities/ai-review-service.md](../entities/ai-review-service.md) — review moves off-chain onto drafts (new draft-keyed tables, runner reworked, no on-chain transition)
- [../entities/creation-fee-vault.md](../entities/creation-fee-vault.md) — the fee is now collected at publish, and finally indexed
- [../concepts/market-lifecycle.md](../concepts/market-lifecycle.md) — adds the pre-chain Draft phase; retires on-chain `UnderReview`; markets born Active
- [../concepts/creation-fee-custody.md](../concepts/creation-fee-custody.md) — fee-on-accept (paid at publish, not submit); no reject burn
- [portfolio-data-design.md](portfolio-data-design.md) — the money-paper-trail invariant the new fee-events record must satisfy
- [root-adr-0011-ai-review-service-hardening.md](root-adr-0011-ai-review-service-hardening.md) / [root-adr-0019-ai-verdict-quality-program.md](root-adr-0019-ai-verdict-quality-program.md) — the review policy this relocates off-chain
- [root-adr-0013-app-feature-completion.md](root-adr-0013-app-feature-completion.md) — the resubmit-copy promise this finally makes real
