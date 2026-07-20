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
accounting, complete-set mint and merge, resolution and cancellation,
redemption and draw redemption. Every postgrad money and lifecycle event is
emitted here — fixed address, `marketId`-indexed. It is the postgrad sibling
of `ReceiptBook`: one book, many markets.

**`WrappedOutcomeToken` (per-market minimal-proxy clones).** The only
per-market deploys. Each graduation clones two thin ERC20 wrappers (YES, NO)
whose sole purpose is to serve as v4 pool currencies. Wrap and unwrap convert
1:1 between book positions and wrapper balances; the wrapper holds the
backing ERC1155 balance, and wrapper supply must equal that holding at all
times. Wrappers contain no market logic and emit nothing but ERC20 events.

**The adapter boundary is preserved.** Per ADR 0007, `finalizeGraduation`
funds per-market collateral capacity — now a book ledger entry instead of a
market deployment — and per-receipt claims distribute retained YES/NO as book
positions. ADR 0008's single-side retained-mint rule carries over unchanged:
retained claims are safe only against already-funded complete-set capacity.

**The solvency invariant restates per market inside the shared book**, where
outcome supply counts wrapped and unwrapped units together:

```txt
before resolution: capacity[marketId] >= max(YES supply, NO supply)
after resolution:  capacity[marketId] >= winning outcome supply
```

**Scope.** This governs the mainnet deployment. Arc Testnet keeps the ADR
0008 factory and its current test load; nothing is rebuilt there. The book is
proven on the devchain first, and the testnet migrates only if we want the
final rehearsal on Arc before mainnet.

## Consequences

Indexing becomes bounded. Complete-set mints and merges, resolutions,
cancellations, and redemptions — the entire postgrad money paper trail —
arrive from one fixed address, keyed by `marketId`. The only dynamic address
set left is wrapper ERC20 `Transfer` tracking (wrapped balances are real
balances), which is one watcher instead of three, and whose members go
permanently quiet once a market terminates, so a hot/cold sweep tier prunes
them safely. Cursor growth tracks active markets, not cumulative history.

Graduation gets cheaper: two minimal-proxy clones instead of a full market
contract plus two token deploys.

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
      cancellation, redemption/draw redemption. Property tests for the
      per-market solvency invariant; behavioral parity tests against
      `CompleteSetBinaryMarket` as the golden reference.
- [ ] **Phase 2 — Wrappers.** `WrappedOutcomeToken` template plus clone
      deployment from the book at graduation; wrap/unwrap; invariant tests
      that wrapper supply always equals the wrapper's book holding.
- [ ] **Phase 3 — Adapter rework.** Graduation finalization funds book
      capacity; retained claims mint book positions; ADR 0008 retained-mint
      constraints carried over with tests.
- [ ] **Phase 4 — Venue integration.** Pools created against wrapper
      currencies on the devchain; hook, order manager, router, and Permit2
      path exercised end to end; seeding path decided (auto-wrap at
      graduation vs. lazy wrap).
- [ ] **Phase 5 — Indexer cutover.** Fixed-address book watchers replace the
      dynamic postgrad-market watcher; wrapper `Transfer` watcher on the
      existing dynamic engine; balance projections sum positions + wrapped.
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

- Position ID scheme: `keccak(marketId, side)` vs. packed sequential IDs —
  affects CTF compatibility and gas.
- Wrap timing: auto-wrap venue liquidity at graduation, or wrap lazily on
  first trade intent?
- Outcome decimals: keep ADR 0008's 18-decimal outcome units with explicit
  conversion, or match collateral decimals to remove the conversion layer?
