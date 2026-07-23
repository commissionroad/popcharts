---
type: summary
title: Repo ADR 0022 — Review-first market creation (off-chain drafts, gated publish, fee-on-accept)
description: Proposed inversion of market creation — questions live as off-chain editable Drafts reviewed before any chain write; on approval the creator publishes via a gated createMarket (authorizer signature, born Active) paying the fee at publish, not submit; plus templates, Privy-auth drafts, and a real-markets-only board.
sources:
  - docs/adr/0022-review-first-market-creation.md
updated: 2026-07-21
---

# Repo ADR 0022: Review-first Market Creation

**Status: Proposed.** Dated 2026-07-21. Designed via a `/grill` session and
adversarially red-teamed before proposal. Not part of the M1–M5 launch chain.

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

## Phased build plan (all open)

Public draft submission opens at P3 (the bond); until then P2 review runs internally.

1. **P1** Draft entity + Privy-authenticated CRUD + "my drafts" surface.
2. **P2** Off-chain AI review on drafts (new draft-keyed tables + reworked runner) — keystone.
3. **P3** `ReviewBondVault` escrow (native-USDC deposit/settle/withdraw) + off-chain fee meter ($5 min, $1/submit incl. 5 reviews, $0.20 after) gating submission + bond-event indexing. **Opens public submission.**
4. **P4** Gated `createMarket` (full-params EIP-712, on-chain single-use nonce, trusted bypass, born Active) + indexer projects `bootstrap` + publish-time authorization + "Publish & pay" + `MarketCreationFeePaid` indexing.
5. **P5** Retire on-chain review machinery + migrate legacy `under_review`/`rejected` rows (tail-only enum removal).
6. **P6** Populate `market_metadata` from the event; drop the off-chain POST.
7. **P7** Templates + clone.
8. **P8** Server-side discovery filters (+ `markets.status`/timestamp indexes; Graduated anti-joins Resolving).

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

## Related pages

- [../entities/pregrad-manager.md](../entities/pregrad-manager.md) — `createMarket` gains the authorizer-signature gate + born-Active; loses `approveMarket`/`rejectMarket`
- [../entities/ai-review-service.md](../entities/ai-review-service.md) — review moves off-chain onto drafts (new draft-keyed tables, runner reworked, no on-chain transition)
- [../entities/creation-fee-vault.md](../entities/creation-fee-vault.md) — the fee is now collected at publish, and finally indexed
- [../concepts/market-lifecycle.md](../concepts/market-lifecycle.md) — adds the pre-chain Draft phase; retires on-chain `UnderReview`; markets born Active
- [../concepts/creation-fee-custody.md](../concepts/creation-fee-custody.md) — fee-on-accept (paid at publish, not submit); no reject burn
- [portfolio-data-design.md](portfolio-data-design.md) — the money-paper-trail invariant the new fee-events record must satisfy
- [root-adr-0011-ai-review-service-hardening.md](root-adr-0011-ai-review-service-hardening.md) / [root-adr-0019-ai-verdict-quality-program.md](root-adr-0019-ai-verdict-quality-program.md) — the review policy this relocates off-chain
- [root-adr-0013-app-feature-completion.md](root-adr-0013-app-feature-completion.md) — the resubmit-copy promise this finally makes real
