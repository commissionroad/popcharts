# ADR 0015: Per-Market Dispute Windows With A Public Floor

## Status

Proposed

## Context

[ADR 0013](0013-bonded-optimistic-resolution-with-dispute-window.md) made
resolution optimistic: the resolver proposes, anyone may bond a dispute inside
a window, and finalization is permissionless once the window closes. Its
"Window sizing" section fixed the window at **24 hours on deployed networks**
and stated that "a zero window is permitted at the contract level (degenerates
to today's behavior) but deployed configurations must not use it."

Two things have changed since.

**The window is contract-scoped, not market-scoped.** Despite being immutable
per market, the value every market receives comes from one adapter-wide field:
`CompleteSetPostgradAdapter.disputeWindow`, set by the owner through
`setDisputeConfig` and stamped onto each child market at `prepareMarket`. Every
market prepared by one adapter therefore carries the same window. Changing it
between two `prepareMarket` calls is an ops race, not a parameter.

**A class of market wants no window at all.** Repo ADR 0028 introduces
recurring five-minute crypto price markets whose outcome is a deterministic
comparison of two timestamped prices. Their whole point is to have nothing to
dispute. A 24-hour adjudication window on a five-minute market is not caution;
it is 288 times the market's own lifespan spent waiting for a challenge that
cannot be substantively made.

The contract already behaves correctly at zero. `dispute()` computes
`deadline = proposedAt + disputeWindow` and reverts `DisputeWindowClosed`
whenever `block.timestamp >= deadline`, so with a zero window **every dispute
reverts** — disputes are impossible by construction, not merely brief.
`finalizeResolution()` reverts only when `block.timestamp < deadline`, so a
zero-window proposal is finalizable in the same block, permissionlessly. What
is missing is not mechanism. It is the ability to choose the value per market,
and a guardrail stopping anyone from choosing zero for themselves.

## Decision

Move `disputeWindow` from adapter-scoped configuration to a per-market
creation parameter, and gate short windows behind the trusted-creator
privilege the manager already enforces for the closest analogue.

### 1. `disputeWindow` becomes a creation parameter

Add `uint64 disputeWindow` to `MarketTypes.CreateMarketParams`. The manager
stores it with the market's other immutable configuration and passes it to
`IPostgradAdapter.prepareMarket` at graduation, where it flows into the child
market's existing immutable `disputeWindow` exactly as the adapter's own field
does today.

The choice is made at **creation**, not at graduation, because that is the only
moment the creator — and therefore their trust status — is in scope.
`prepareMarket` is called by the manager during graduation settlement, long
after the creator's transaction; the caller there is the manager itself.

This is a breaking change to the EIP-712 typehash. Both
`CreateMarketParams(...)` and the `MarketCreationAuthorization(...)` string
that embeds it change, so the off-chain authorizer and the app must move in the
same release as the contract. That is the same coordination
[repo ADR 0022](../../../docs/adr/0022-review-first-market-creation.md)'s
authorized-creation path already requires for any parameter change.

### 2. A public floor, owner-settable, defaulting to 24 hours

A non-trusted creator must supply `disputeWindow >= publicMinimumDisputeWindow`.
The floor is owner-settable storage on the manager with an event, initialized to
**24 hours** on deployed networks. A trusted creator may supply any value,
including zero.

The check belongs in `_validateCreateMarketParams` beside its exact analogue:

```solidity
if (params.bypassAiResolution && !trustedCreator) {
  revert UnauthorizedAiResolutionBypass(msg.sender);
}
```

`bypassAiResolution` is already a trusted-creator-only escape from a safety
mechanism. A zero dispute window is the same shape of decision about the same
pipeline, and belongs under the same privilege rather than a second one.

The floor is settable rather than constant because it is explicitly expected to
change: 24 hours is a starting posture for testnet, not a derived number. Making
it storage means revisiting it is an owner transaction, not a redeploy of the
manager.

Note the small structural consequence: `_validatePublicCreateMarketParams` is
`private pure` today. Reading a stored floor makes it `view`, and
`_validateCreateMarketParams` with it.

### 3. The adapter keeps the bond, loses the window

`setDisputeConfig` continues to own `disputeBond`, which is a protocol-wide
economic parameter rather than a per-market one. The adapter's `disputeWindow`
field is removed; `prepareMarket` takes the window from its caller.

### 4. What this amends in ADR 0013

ADR 0013's "Window sizing" section is superseded on one point only: a zero
window **is** permitted in deployed configurations, restricted to markets
created by trusted creators. Everything else in that ADR — the status machine,
the bond mechanics, the permissionless finalize, the singleton-book
compatibility argument — stands unchanged. The window remains immutable per
market once set; this ADR changes who chooses the value and when, not whether
it can move afterwards.

## Consequences

Positive:

- Deterministic markets settle at their own pace instead of the slowest
  market's. A five-minute market is fully settled within one keeper tick of its
  expiry.
- The dispute window becomes visible where every other market parameter already
  is — in the creation payload, in the authorizer's signed struct, and in the
  indexed `MarketCreated` event — instead of being invisible adapter state that
  a reader has to go find.
- The floor is enforced at the point of creation, so a market whose window is
  too short simply cannot exist, rather than existing and needing to be caught
  later.

Tradeoffs:

- A breaking EIP-712 change requiring the contract, the authorizer, and the app
  to ship together.
- Two markets created before and after a floor change carry different windows.
  This is correct — the floor binds at creation — but it means the floor is not
  a global invariant over live markets, and any UI claiming "all markets have at
  least 24h" would be wrong. Surface the market's own window, not the floor.
- Trusted-creator status becomes load-bearing for one more thing. The blast
  radius of granting it grows, and the grant is a single owner call with no
  per-privilege granularity. Accepted for testnet; a mainnet design should
  consider splitting the privilege.

## Related

- Protocol ADR 0013 — the optimistic resolution mechanism this parameterizes,
  and whose window-sizing decision this amends.
- Protocol ADR 0012 — the singleton position book. `disputeWindow` remains
  per-market state and transfers onto `marketId`-keyed book state unchanged.
- Repo ADR 0024 — the cross-stack program that landed ADR 0013.
- Repo ADR 0028 — the recurring price markets that motivate a zero window.
- Repo ADR 0022 — authorized creation, whose signed parameter struct this
  extends.
