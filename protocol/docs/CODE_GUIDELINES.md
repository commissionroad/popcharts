# Protocol Code Guidelines

## General

Use the domain language in `CONTEXT.md`. Do not introduce synonyms for core
concepts unless the glossary changes first.

Keep modules deep. A contract or library should expose a small interface and
hide the tricky accounting behind tests.

Avoid speculative extensibility. Add abstractions when they remove real
complexity or protect a protocol invariant.

## Solidity

Use explicit custom errors instead of generic revert strings.

Use OpenZeppelin for standards such as ERC-20 behavior, ownership, and safe
token transfer helpers.

Keep external functions thin:

- validate inputs
- update state
- emit events
- perform bounded external interactions

Keep math and clearing logic in libraries with focused unit tests. Protocol
contracts should orchestrate these libraries instead of burying formulas inside
large lifecycle functions.

Prefer immutable deployment configuration for values that define a market:
collateral token, creator, metadata hash, opening probability, `b`, graduation
threshold, and close time.

Document only non-obvious accounting or security constraints. Do not restate
what the code already says.

## Events And Reads

Events and view methods should serve the product surface:

- market creation
- receipt placement
- path interval and cost basis
- freeze and clearing start
- matched market cap
- retained shares and retained cost
- refunds
- graduation and resolution

Avoid events that require indexers to infer core state from ambiguous names.

## Security Posture

No final fixed-payout exposure exists before graduation.

No receipt withdrawal or transfer exists in v1.

No clearing path may create a claim whose maximum payout exceeds locked
collateral.

No later resolution or post-graduation venue may rescue an undercollateralized
bootstrap market.

Use checks-effects-interactions, guarded token transfers, deterministic rounding,
and explicit dust policy once clearing math is implemented.
