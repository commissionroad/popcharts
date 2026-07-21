---
type: summary
title: "Protocol ADR 0012: Use A Singleton Postgrad Position Book"
description: Proposed mainnet path — one ERC1155 position book for all postgrad markets plus per-market ERC20 wrapper clones as v4 pool currencies; resolves ADR 0008's bounded testnet deviation.
sources:
  - protocol/docs/adr/0012-use-a-singleton-postgrad-position-book.md
updated: 2026-07-20
---

# Protocol ADR 0012: Use A Singleton Postgrad Position Book

**Status: Proposed** (2026-07-20, under review). This is the "later ADR" that
[ADR 0008](protocol-adr-0008-complete-set-erc20-arc-testnet.md) promised when
it bounded the per-market ERC20 factory to Arc Testnet.

## The decision

A hybrid of [ADR 0007](protocol-adr-0007-ctf-style-postgrad-handoff.md)'s
ERC1155 interop target and the shipped v4 venue:

- **`PostgradPositionBook`** — a singleton ERC1155 contract holding every
  graduated market's YES/NO positions as token IDs. It absorbs all of
  [CompleteSetBinaryMarket](../entities/postgrad-market.md)'s
  responsibilities: collateral escrow (per-market capacity ledger),
  complete-set mint/merge, resolution/cancellation, redemption. Every
  postgrad money and lifecycle event becomes fixed-address and
  `marketId`-indexed — the postgrad sibling of `ReceiptBook`.
- **`WrappedOutcomeToken` minimal-proxy clones** — the only per-market
  deploys (two per graduation), thin ERC20 wrappers over book positions
  existing solely because Uniswap v4 pool currencies must be ERC20s.
  Wrap/unwrap 1:1; wrapper supply must always equal the wrapper's ERC1155
  holding; no market logic in wrappers.
- The [adapter](../entities/postgrad-adapter.md) boundary survives:
  `finalizeGraduation` funds a book ledger entry instead of deploying a
  market; retained claims mint book positions under ADR 0008's
  retained-mint constraints — with unclaimed retained positions reserved as
  explicit liabilities so resolution can never strand a lazy receipt claim
  (a hazard the current Trading-only retained-mint gate has).
- The solvency invariant restates per market in three states (trading,
  resolved, cancelled-draw), counting wrapped + unwrapped supply, plus a new
  global conservation invariant shared custody demands: per collateral
  token, book balance ≥ Σ per-market capacity ledgers, via exact
  balance-delta checks.
- The book emits a wrapper-registration event per clone (marketId, side,
  position id) as the event-first discovery root — raw ERC20 `Transfer`
  logs carry neither.

## Why

- **Scale mandate:** as a launchpad, hundreds/thousands of markets per day at
  adoption. The ADR 0008 factory mints three addresses per graduation, giving
  every money-following consumer (indexer subscriptions, cursors, monitoring)
  an unbounded address set. The book bounds the contract set at the protocol.
- **Venue constraint:** ERC1155 IDs can't be v4 pool currencies, and the v4
  venue (hook, order manager, router, trading UI) is built and in use — pure
  Gnosis-CTF would force a venue rebuild or reintroduce per-market ERC20s
  unplanned.

## Consequences recorded

The money paper trail becomes fixed-address (three dynamic watchers become
one, and the survivor only tracks balances) — but the ADR is explicit that
the contract set is not fully bounded: two wrapper clones still deploy per
market, wrapper `Transfer` tracking stays dynamic (terminal markets go quiet
as balances unwind, prunable via hot/cold tiers, not instantly). Graduation
gets cheaper (two clones vs. three full deploys). The honest security trade:
all postgrad collateral concentrates in one contract (honeypot, cross-market
bug risk) in exchange for one auditable, pausable surface instead of an
immortal factory template — acceptable only with invariant/fuzz coverage,
external audit, and launch caps. Balances live in two shapes (positions +
wrapped), so portfolio accounting sums both. The venue exit path for
terminal markets (withdraw → unwrap → redeem while balances sit in pools,
orders, LP positions) is a named design obligation — today nothing gates
swaps on market lifecycle.

Scope: mainnet path only — Arc Testnet keeps the ADR 0008 factory. Six
phases (book core → wrappers → adapter rework → venue integration → indexer
cutover → deployment path); deferred: singleton governance design, full
Gnosis-CTF ID compatibility, hot/cold indexer tiering, optional testnet
migration. Open questions: outcome decimals (BLOCKING — 18-decimal
dust-rejecting redemption vs. arbitrary v4 swap amounts creates
non-redeemable dust), position ID scheme, wrap timing, post-resolution swap
policy.

## Touches

- [Complete sets](../concepts/complete-sets.md) — the tokenization decision
- [CompleteSetBinaryMarket](../entities/postgrad-market.md) — superseded on
  mainnet by the book if accepted
- [Postgrad adapter](../entities/postgrad-adapter.md) — prepareMarket rework
- [Indexer](../entities/indexer.md) — dynamic-address machinery becomes
  bounded
- [Postgrad v4 venue](../entities/postgrad-v4-venue.md) — pools quote
  wrapper currencies
