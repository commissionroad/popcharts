# Pop Charts

Pop Charts is a no-liquidity prediction-market launchpad. It lets markets
discover demand on a virtual LMSR curve before graduating into fully backed
YES/NO complete sets.

## Language

**Market**:
A binary question with a lifecycle, displayed probability, receipts, and a path
toward graduation. A Market exists on-chain; it begins only when a Draft is
approved and published.
_Avoid_: Pool, event

**Draft**:
An off-chain, editable, owner-private question that has not yet been published
on-chain. It carries the same content a Market needs, moves through review
(editing → in review → rejected or approved), and becomes a Market only when the
owner publishes it. A rejected Draft is reworked and resubmitted, never lost.
_Avoid_: Market (a Draft is not yet a Market), submission

**Template**:
A Draft kept as a reusable starting point. Cloning any Draft or Market seeds a
new editing Draft pre-filled from it; a Template is simply a Draft flagged to
keep and clone from.
_Avoid_: Preset, boilerplate

**Virtual LMSR**:
The pre-graduation pricing curve. Its `b` parameter controls smoothness but is
not backed by a protocol bankroll.
_Avoid_: Funded market maker, liquidity pool

**Priced intent**:
A pre-graduation buy priced by the virtual LMSR. It records demand but is not a
final outcome-token fill.
_Avoid_: Fill, final trade

**Receipt**:
The user's record of a priced intent. It captures side, cost, shares, and the
price band traversed while capital waits for clearing or refund.
_Avoid_: Position, share

**Price band**:
The probability interval swept by a receipt along the LMSR path.
_Avoid_: Range, bucket

**Band-pass clearing**:
The graduation rule that passes price bands traversed by both YES and NO demand
in opposite directions.
_Avoid_: Matching engine, auction

**Matched segment**:
The portion of a receipt that clears into fully collateralized YES/NO complete
sets.
_Avoid_: Guaranteed fill

**Refunded segment**:
The portion of a receipt that does not clear and is returned at exact path cost.
_Avoid_: Loss, failed trade

**Graduation**:
The transition from receipts into backed outcome tokens when enough compatible
opposing demand exists.
_Avoid_: Launch, listing

**Complete set**:
A fully collateralized YES/NO pair backing fixed-payout outcome tokens after
graduation.
_Avoid_: Virtual share

**Resolution**:
The post-graduation truth outcome for a market.
_Avoid_: Graduation
