# ADR 0012: Use A Singleton Postgrad Position Book

## Status

Proposed

## Context

ADR 0007 set the interoperability target for postgrad tokenization: CTF-style,
ERC1155-compatible where possible. ADR 0008 knowingly deviated for Arc Testnet
speed — per-market ERC20 complete-set markets — and bounded that deviation
"until a later ADR resolves the mainnet path: Gnosis CTF, ERC20 wrappers,
CLOB, v4 venue, or another compatible structure." This is that ADR.

Two facts drive the decision.

**The scale mandate.** Pop Charts is a prediction-market launchpad. At
adoption we expect hundreds to thousands of market creations per day. Market
creation is already singleton-cheap (rows in `PregradManager` state), but
graduation is a factory step: `CompleteSetPostgradAdapter` deploys a new
`CompleteSetBinaryMarket`, which deploys two `OutcomeToken` ERC20s — three
fresh contract addresses per graduated market. Every consumer that follows
money then inherits an unbounded address set: indexer subscriptions and
sweeps, per-address cursors, deployment records, monitoring, incident
response. The indexer can compensate (topic-only subscriptions, collective
watermarks, hot/cold sweep tiers), but all of that is machinery built to
absorb a protocol that manufactures addresses. Bounding the contract set at
the protocol removes the entire problem class.

**The venue constraint.** Uniswap v4 pool currencies must be ERC20 contracts;
ERC1155 token IDs cannot be pool currencies. The v4 venue layer — bounded
hook, order manager, swap router, and the trading UI built on them — is
implemented and carrying real usage. A pure ERC1155 design (full Gnosis-CTF
shape) would force abandoning that venue for an off-chain-matched CLOB, or
would reintroduce per-market ERC20s through the back door as unplanned
wrappers. The venue is worth keeping; the wrappers should be planned, minimal,
and the only per-market deploys.

## Decision

Adopt a hybrid singleton-plus-wrappers architecture as the mainnet path.

**`PostgradPositionBook` (singleton, ERC1155).** One contract holds every
graduated market's YES/NO positions as token IDs derived from the market id
and side. It absorbs all responsibilities of today's per-market
`CompleteSetBinaryMarket`: collateral escrow with per-market capacity
accounting, complete-set mint and merge, resolution and cancellation
(including the per-market, per-side resolution time gates the adapter
configures today — `yesNotBefore`/`noNotBefore` are book state, enforced in
`resolve`), redemption and draw redemption. Every postgrad money and
lifecycle event is emitted here — fixed address, `marketId`-indexed. It is
the postgrad sibling of `ReceiptBook`: one book, many markets.

**`WrappedOutcomeToken` (per-market minimal-proxy clones).** The only
per-market deploys. Each graduation clones two thin ERC20 wrappers (YES, NO)
whose sole purpose is to serve as v4 pool currencies. Wrap and unwrap convert
1:1 between book positions and wrapper balances; the wrapper holds the
backing ERC1155 balance, and wrapper supply must equal that holding at all
times. That equality is not free: the wrapper is an ERC1155 receiver, so its
callbacks must strictly validate operator, position id, amount, and wrap
intent — an unsolicited or batched transfer of the wrong id must not inflate
its holding without minting supply. Wrappers contain no market logic and emit
nothing but ERC20 events; the book emits an immutable wrapper-registration
event at graduation mapping each clone address to its market id, side, and
position id — the event-first discovery root for indexing, playing the role
`PostgradMarketPrepared` plays today.

**The adapter boundary is preserved — with terminal-claim liabilities made
explicit.** Per ADR 0007, `finalizeGraduation` funds per-market collateral
capacity — now a book ledger entry instead of a market deployment — and
per-receipt claims distribute retained YES/NO as book positions under ADR
0008's single-side retained-mint rule (safe only against already-funded
complete-set capacity). One carry-over is deliberately *not* unchanged:
today's market accepts retained mints only while `Trading`, and receipt
claims are lazy with no deadline — so resolving today's market strands every
unclaimed receipt. The book must account outstanding unclaimed retained
positions as an explicit reserved liability at funding time and honor claims
in terminal states (resolved: winning-side claims redeem; cancelled: claims
redeem at the draw rate), so resolution can never strand a claimant.

**The solvency invariant restates per market inside the shared book** —
covering all three terminal states, with outcome supply counting wrapped and
unwrapped units together and unclaimed reserved liabilities included:

```txt
trading:   capacity[marketId] >= max(YES supply, NO supply)
resolved:  capacity[marketId] >= winning outcome supply
cancelled: capacity[marketId] >= (YES supply + NO supply) / 2
```

Shared custody adds a conservation invariant the isolated contract never
needed, because it derived capacity from its own balance: for each collateral
token, `book balance >= sum of all per-market capacity ledgers`, maintained
by exact balance-delta checks on every deposit (no fee-on-transfer
surprises) and ledger debits before every payout. Without this, one deposit
could back two markets while every per-market ledger still looks solvent.

**Scope.** This governs the mainnet deployment. Arc Testnet keeps the ADR
0008 factory and its current test load; nothing is rebuilt there. The book is
proven on the devchain first, and the testnet migrates only if we want the
final rehearsal on Arc before mainnet.

## Consequences

The money paper trail becomes fixed-address. Complete-set mints and merges,
resolutions, cancellations, and redemptions all arrive from one address,
keyed by `marketId`. To be precise about what this does *not* claim: the
contract set is not fully bounded — each graduation still deploys two wrapper
clones (down from three contracts), and wrapper `Transfer` tracking remains a
dynamic-address watcher, since wrapped balances are real balances and remain
transferable even after resolution (unwinding a terminal market itself emits
unwrap Transfers). The current engine already coalesces aligned-watermark
addresses into shared `getLogs` calls, so the RPC-shape win is incremental.
The qualitative wins are that every event carrying money semantics leaves the
dynamic set entirely (three dynamic watchers become one, and the survivor
only tracks balances), and that terminal markets go quiet as their wrapped
balances unwind — a hot/cold sweep tier can demote them losslessly (the
watermark re-sweeps anything), keeping hot-set size proportional to active
markets rather than cumulative history.

Graduation gets cheaper: two minimal-proxy clones instead of a full market
contract plus two token deploys.

The venue does not automatically respect market lifecycle: today nothing
stops the swap router after resolution (the hook checks tick bounds, not
status), de-whitelisting only blocks new managed orders, and resolved-market
liquidity sits in pools, open orders, and LP positions denominated in
wrappers. The mainnet exit path — withdraw/cancel venue positions → unwrap →
redeem — is a design obligation of this ADR, proven end to end in Phase 4,
including an explicit decision on whether post-resolution swaps stay enabled.

Interoperability improves: ERC1155 positions are CTF-shaped, one approval
covers all markets, and third-party integrations address positions by ID
instead of discovering contracts.

The security trade is real and must be named. Today one market's exploit
drains one market's escrow; the book concentrates all postgrad collateral in
a single contract — a honeypot — and a cross-market accounting bug could
corrupt every market at once. In exchange, there is one audit surface instead
of an immortal template stamped into thousands of unpatchable instances, and
one pause switch instead of none. This trade is acceptable only with:
per-market solvency enforced as a code-level invariant with property/fuzz
coverage, an external audit before mainnet funds, and capped market sizes at
launch. Admin powers over the book (pause, resolution overrides) are
singleton-wide and must follow the established operator model (server-
triggered, no operator endpoints on the deployed API).

Balances now live in two shapes — book positions and wrapped ERC20 — so
portfolio accounting sums both, and redemption from a wrapped balance
requires an unwrap step (or a periphery helper that composes unwrap+redeem).
The venue contracts should be indifferent to wrappers (they are ordinary
ERC20s), but approval paths, Permit2 flows, and decimal conversions must be
re-verified against them, not assumed.

## Phases

- [ ] **Phase 1 — Book core.** `PostgradPositionBook` with ERC1155 positions,
      per-market capacity ledger, complete-set mint/merge, resolution/
      cancellation with per-side time gates, redemption/draw redemption.
      Property/fuzz tests must cover all three invariant states (trading,
      resolved, *and* cancelled draw liabilities) plus the global
      collateral-conservation invariant across concurrent markets; behavioral
      parity tests against `CompleteSetBinaryMarket` as the golden reference.
- [ ] **Phase 2 — Wrappers.** `WrappedOutcomeToken` template plus atomic
      clone deployment and registration event from the book at graduation;
      wrap/unwrap with strictly validating ERC1155 receiver callbacks
      (operator, id, amount, wrap intent) and reentrancy handling; invariant
      tests including unsolicited transfers, batch transfers, and wrong-id
      transfers — not just happy-path supply equality.
- [ ] **Phase 3 — Adapter rework.** Graduation finalization funds book
      capacity *and reserves outstanding retained-claim liabilities*;
      retained claims mint book positions in trading and terminal states
      (resolved/cancelled claims redeem at their terminal rates); ADR 0008
      retained-mint constraints with tests, including resolve-with-unclaimed-
      receipts scenarios.
- [ ] **Phase 4 — Venue integration.** Pools created against wrapper
      currencies on the devchain; hook, order manager, router, and Permit2
      path exercised end to end; seeding path decided (auto-wrap at
      graduation vs. lazy wrap). Terminal-market exit test: resolve and
      cancel markets *while* wrapper balances sit in pools, open orders, and
      LP positions, then prove withdraw → unwrap → redeem for every holder;
      decide and document post-resolution swap policy.
- [ ] **Phase 5 — Indexer cutover.** Fixed-address book watchers replace the
      dynamic postgrad-market watcher; wrapper discovery driven by the book's
      wrapper-registration event (raw ERC20 `Transfer` logs carry no
      `marketId` or side); wrapper `Transfer` watcher on the existing dynamic
      engine; balance projections sum positions + wrapped.
- [ ] **Phase 6 — Deployment path.** Devchain exit criteria, audit scope, cap
      policy, mainnet deployment manifest.

## Deferred Work

- Singleton admin/governance design (who can pause, upgrade posture, timelock
  or not) — must land before mainnet funds, builds on the operator model.
- Full Gnosis-CTF ID compatibility (conditionId/collectionId derivation)
  versus merely CTF-shaped IDs — decide before courting external
  integrations; not needed for our own venue.
- Hot/cold indexer sweep tiering — orthogonal to this ADR and useful under
  either architecture; build when graduated-market counts warrant it.
- Testnet migration to the book (optional final rehearsal on Arc).

## Open Questions

The first item must be resolved before this ADR is accepted; the rest before
their phase begins.

- **Outcome decimals (blocking).** ADR 0008's 18-decimal outcome units with
  dust-rejecting conversion interact badly with v4: swaps produce arbitrary
  raw wrapper amounts, and exact-or-revert redemption turns the remainder
  into permanently non-redeemable dust. Either match collateral decimals
  (removing the conversion layer) or specify rounding/aggregation and
  residual-collateral treatment, with adversarial v4 tests. Undecided, this
  is a user-funds correctness hole, not a style choice.
- Position ID scheme: `keccak(marketId, side)` vs. packed sequential IDs —
  affects CTF compatibility and gas.
- Wrap timing: auto-wrap venue liquidity at graduation, or wrap lazily on
  first trade intent?
- Post-resolution swap policy: leave pools swappable after resolution (price
  discovery on a settled outcome is noise, but freezing needs hook lifecycle
  awareness) or gate swaps on market status (see Phase 4).
