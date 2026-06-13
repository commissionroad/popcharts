# Pop Charts Protocol Context

This file is a glossary. It intentionally avoids implementation details.

## Virtual LMSR

The pre-graduation pricing curve. It quotes implied probabilities and records
the price path that receipts traverse. Its state is demand-pricing state, not
sold inventory.

## `b`

The LMSR liquidity parameter. In Pop Charts it means virtual smoothness. It is
not a funded bankroll or loss budget.

## Receipt

A pre-graduation priced intent. It records the owner, side, shares, escrowed
cost, and exact path interval traversed by a trade. It is provisional until
graduation or refund.

## Path

The one-dimensional LMSR coordinate traversed by receipts. YES demand moves the
path in one direction; NO demand moves it in the opposite direction.

## Price Band

An adjacent interval of the path used during band-pass clearing. A band can
graduate only when both YES and NO demand covered it in opposite directions.

## Band-Pass Clearing

The graduation clearing rule. It passes only path bands crossed by both sides,
retains the scarce side fully, prorates the crowded side within each band, and
refunds unmatched path cost.

## Graduation

The transition from provisional receipts to fully collateralized YES/NO complete
sets. Graduation happens only after deterministic clearing proves enough
path-compatible matched market cap.

## Matched Liquidity

The path-compatible filled market cap proven by clearing. It is not raw volume,
total escrow, or headline open interest.

## Retained Cost

The portion of a receipt's escrow assigned to graduated path segments. It is
computed from those exact retained bands, not from the receipt's average price.

## Refund

The portion of receipt escrow returned because its path segments did not
graduate, were crowded out, or the market failed to reach the graduation
threshold.

## Complete Set

A fully collateralized YES/NO pair backed by one unit of collateral. Complete
sets are the post-graduation fixed-payout market object.

## Status Ladder

The product lifecycle vocabulary is `Bootstrap`, `Graduating`, `Graduated`,
`Resolved`, and `Refunded`. Contract lifecycle states may include finer-grained
implementation states such as frozen-for-clearing, but product reads should map
back to this ladder.
