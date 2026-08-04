# Review-first market creation: off-chain drafts, gated on-chain publish, and creator surfaces

Status: Accepted — P1, P2, P3 and P7 built 2026-07-30..08-03 (plus P4's app half);
P4's contract/indexer/fee-indexing work and P5, P6, P8 are open. On-chain
`createMarket` is still ungated in the interim — see P4 below.

## Context

Today a market is created **on-chain first, then reviewed**. `PregradManager.createMarket`
is `payable`; it collects the flat creation fee atomically (`_collectCreationFee`
reverts unless `msg.value` equals the fee) and records the market on-chain in
`UnderReview`. The off-chain AI-review runner then calls `approveMarket` (→ `Active`,
projected as `bootstrap`) or `rejectMarket` (→ `Rejected`) with a review-manager key,
and the indexer projects the result. Three facts make this painful for creators:

- **A rejection is terminal and the fee is gone.** `rejectMarket` is a one-way on-chain
  transition; there is no creation-fee refund path anywhere. The creator loses the
  market *and* the fee, with no appeal surface (ADR 0019 states this explicitly).
- **There is no way to iterate.** No draft is persisted; a market row exists only after
  the indexer sees `MarketCreated`. "Fixing" a rejected question means paying again for
  a brand-new on-chain market, plus gas.
- **The public list shows everything.** `getMarkets` applies no status filter, so
  `under_review` and `rejected` markets appear on the discovery board alongside real ones.

This also resolves a standing contradiction in the docs: ADR 0013 promises copy telling a
creator "what they can change before resubmitting," while ADR 0019 documents that reject is
terminal with no appeal. Nothing reconciled them. This ADR does.

## Decision

**Invert the flow: review-first.** A market question lives as an off-chain, editable
**Draft** while it is being reviewed. It never touches the chain until it is approved. On
approval the creator **publishes** it on-chain — paying the creation fee at that moment —
and only then does it become a **Market**. Rejected and in-progress drafts are free,
editable, and private to their owner.

Concretely:

1. **Draft is a new off-chain entity** (its own `market_drafts` table), distinct from a
   `Market`. Its *content* mirrors the `createMarket` params (question, description,
   resolution criteria, resolution sources, category, collateral, opening probability,
   liquidity parameter, graduation threshold; graduation deadline and resolution time are
   stored as **relative durations**, see decision 4). Its *bookkeeping* columns add: id,
   `owner_user_id` (the Privy user / DID), `intended_creator_address` (lowercased wallet the
   creator expects to publish from), `status`, `is_template`, `visibility`, `deleted`
   (soft-delete), timestamps (created / updated / submitted / reviewed / published),
   `published_market_id` (the back-link, set once live), and a pointer to the latest
   rejection's reasons. Note the **publish authorization is not stored on the draft** — it is
   minted fresh at publish time (decision 4). Drafts **linger forever**; a user can
   soft-delete (`deleted`) to hide them.

2. **Draft lifecycle:**

   ```
   editing ──submit──▶ in_review ──reject──────────────▶ rejected ──edit──▶ editing
      ▲ (templates                │
        live here)                ├──changes_requested ─▶ changes_requested ──edit──▶ editing
                                  │
                                  └──approve──▶ approved ──publish&pay──▶ published
                                                                             │
                                                              (on-chain Market born Active;
                                                               draft retained, linked, cloneable)
   deleted = soft-delete flag, valid from any state
   ```

   `rejected` is the *policy* outcome and `changes_requested` the *quality* one (a
   `manual_review` verdict lands here); both are editable and resubmittable, so the
   creator's loop is the same either way. `changes_requested` was added during the
   build — see P2 in the phased plan.

3. **Two separate charges: the creation fee (at publish) and the review bond (at submit).**
   > **Superseded in part — see "Amendment: prepaid review credit" below.** The refundable
   > standing bond, the $5 floor, the $1/5-reviews + $0.20 price schedule, and on-chain
   > settlement are all replaced by a non-refundable prepaid credit at a single per-review
   > rate. The split between creation fee and review charge, the off-chain metering, and the
   > native-USDC denomination described here are unchanged.

   The existing **creation fee** stays fee-on-accept — paid by the creator when they publish
   (`createMarket`); rejected/iterated drafts never pay it. Separately, a **prepaid, refundable
   review bond** funds the AI-review pipeline and is the Sybil defence (rate limiting alone is
   not Sybil-resistant, because SSO users get free embedded wallets, and each review spends
   real provider money):

   - A creator posts a **standing bond** (minimum **$5**) into a separate escrow contract; it
     is a prepaid balance, **refundable** — withdraw the unused remainder anytime. **No
     slashing** (a "we kept your bond because we judged you abusive" flow is a contentious
     moderation-money decision; the per-use fees below already price out spam).
   - **Submitting a draft for review costs $1**, which bundles **up to 5 review runs** (so the
     reject → edit → resubmit loop of that draft is covered for its first 5 cycles). The **6th+
     review of the same draft costs $0.20** each.
   - These fees are **metered off-chain** (in the DB, against the bonded balance) so submitting
     and iterating stay free-feeling and never touch the chain; only the bond **deposit,
     settlement, and withdrawal** are on-chain (see "Review-bond escrow contract").
   - **Denomination is the chain's native USDC**, collected via `msg.value` exactly like the
     existing creation fee (on Arc, USDC *is* the native token; dev reuses the existing
     "native devchain token stands in for USDC" convention). So $5 = `5e18`, $1 = `1e18`,
     $0.20 = `2e17` — **no ERC-20 `approve` step**. (The real-dollar peg of `1e18` is the
     inherited ADR 0009 Q1, unchanged.)

   Net anti-spam: a fresh identity must fund ≥$5 and pay $1/submission (+$0.20/extra review),
   so free embedded wallets no longer make review free — closing the exposure the red-team
   flagged. Coarse per-wallet/per-user rate limiting stays as a cheap first layer.

4. **The creator publishes** (not a platform relay), and the **publish authorization is
   minted at publish time, not cached from approval.** Approval only marks the draft
   *eligible*. When the creator clicks "Publish & pay", the server re-checks the draft is
   still `approved` and unchanged, **resolves the relative durations into absolute
   `graduationDeadline` / `resolutionTime` / `yesNotBefore` timestamps at that moment**, and
   mints a short-lived, single-use authorization over those final params (decision 5). The
   creator signs `createMarket` and pays the fee + gas.

   This dissolves the staleness problem: because deadlines are stored as durations and
   resolved at publish, an approved draft that lingers for weeks is still publishable (its
   window is measured from publish, not from approval), and there is no cached signature
   binding a now-past absolute deadline. Any edit returns the draft to `in_review`.

5. **On-chain creation is gated by an authorizer signature.** `createMarket` gains a
   creation authorization: an EIP-712 signature from an owner-set **authorizer** key. It
   binds the creator (`msg.sender`), **the full final `CreateMarketParams`** (every economic
   field and resolved deadline — not merely `metadataHash`, which commits only the question
   text and would leave `b`, opening probability, and the deadlines unauthorized), a
   **single-use nonce that the contract records and consumes** (revert on reuse; without
   on-chain consumption a bearer signature could mint duplicate markets), and an expiry. The
   EIP-712 domain includes `chainId` + `verifyingContract` (standard, and it reuses the
   contract's existing domain pattern) to prevent cross-chain / cross-deploy replay. Without
   a valid, matching, unexpired, unconsumed signature the call reverts — so there is no
   direct-to-contract path that skips review. **Trusted creators (owner-set
   `isTrustedCreator`) bypass the signature entirely** (as they already bypass the fee). This
   is the path for vetted parties to create without our per-draft approval; there are none
   yet, but the mechanism must exist.

6. **Retire the on-chain review states, born Active.** Because a market can only be created
   *after* off-chain approval, it is born **`Active`**. This requires **two coupled changes
   that must land together**: (a) the contract sets new markets to `Active`; and (b) the
   indexer's `MarketCreated` handler — which today hardcodes the projected status to
   `under_review` ([market-created.ts:120]) and relies on the review watcher to promote it —
   must instead project new markets directly to `bootstrap` (and the `markets.status` column
   default changes). We remove the on-chain `UnderReview` status, `approveMarket` /
   `rejectMarket`, the review-manager key, and the indexer's market-review watcher. AI review
   lives entirely off-chain, on drafts. This is a deliberate shift from **permissionless
   creation + post-hoc review** to **permissioned creation gated by review**.

7. **Metadata needs no contract change.** The full question/description is *already*
   emitted on-chain in the `MarketCreated` event (`string metadata`) and hash-committed
   (`keccak256(metadata) == metadataHash`), and the indexer already reads it. That is
   sufficient for transparency and for a future hash-verifying optimistic oracle (which is
   handed the text as ancillary data and checks it against the on-chain hash). The only
   change is a **server cleanup**: populate the display `market_metadata` table from the
   on-chain event the indexer already reads, and drop the fragile best-effort off-chain
   metadata POST (today a failed POST leaves a market with blank on-screen text even though
   the truth is on-chain). Storing the text in contract *storage* (so an on-chain contract
   could read it directly) is deferred until a concrete oracle design requires it.

8. **Drafts are authenticated via the Privy auth token.** Draft reads/writes are **not**
   address-in-query (which would let anyone read, edit, or delete another user's drafts). The
   server verifies the Privy-issued JWT (issuer, audience, expiry, signature against Privy's
   keys) and scopes drafts to the Privy user (`owner_user_id`). This works identically for
   **EOA** users (external wallet linked to Privy) and **SSO** users (embedded wallet from
   social/email login) — both get a verifiable token; the linked wallet (external or
   embedded) is what later signs the publish transaction.

9. **Templates.** A universal **clone** action seeds a new `editing` draft, pre-filled from
   any source: one of your drafts, one of your published markets, or **any market by pasted
   id**. Clone copies content **verbatim** (the creator fixes date fields themselves).
   `is_template` is an organizational shelf label — a template is a normal draft you keep to
   clone from. The schema carries a `visibility` field so templates can later be **shared**;
   sharing is not built initially (private-only).

10. **Creator surfaces.** A separate creator area shows the user's own drafts, rejected
    drafts, templates, and published markets. Because drafts are Privy-user-scoped while an
    on-chain market's `creator` is a single lowercased wallet address, **"my published
    markets" resolves through two joins, not one**: (a) authoritatively via
    `draft.published_market_id` (covers every market created through this flow, regardless of
    which wallet is currently active); (b) for markets with no draft — legacy on-chain-first
    markets and future trusted-creator markets — via `markets.creator ∈ {lowercased wallets
    linked to this Privy user}`, normalizing case on both sides. The surface also shows a
    **`publishing` transient state** for the window between the publish tx and the indexer
    projecting the market, so a just-paid creator always sees their market somewhere (the
    `MarketCreated` event returns the `marketId`, so the draft can flip to `published` from
    the tx receipt before indexing). The **public discovery board shows real markets only** —
    drafts, rejected, and under-review never appear (and `under_review` ceases to exist
    on-chain).

11. **Discovery filters** over the remaining lifecycle: **Pre-grad** (the `bootstrap`
    status), **Graduating**, **Graduated**, **Resolving**, **Resolved**, plus terminal
    **Refunded** and **Cancelled** (included so users can still find markets they need to
    claim refunds or redemptions from; note the owner-scoped portfolio surface is the
    authoritative "what can I claim" view — the board is discovery, not claim-finding).
    `Resolving` is **derived**, not a stored status: a `graduated` market with an in-flight
    resolution job. Because `Resolving` is a strict subset of `graduated`, the **Graduated
    filter must anti-join out in-flight-resolution markets** (`NOT EXISTS` over
    `market_resolution_jobs`) or the same market shows under both chips. Filtering moves
    server-side, which needs a btree index on `markets.status` (and likely
    `markets.created_block_timestamp` for the existing `ORDER BY`) — neither exists today.

## Draft review data model

The existing AI-review tables cannot be reused as-is: `market_ai_reviews` and
`market_ai_review_jobs` carry `marketId NOT NULL` and FKs to `markets(chainId, marketId,
metadataHash)` **and** `market_metadata(chainId, metadataHash)`. A draft under review has no
`marketId` and no `markets`/`market_metadata` row (both are created only at/after publish).
So review-first requires **draft-keyed review + job tables** (keyed on the draft's primary
key, without the on-chain-market FKs), and a **reworked runner** that enqueues from
`market_drafts` (not by selecting `markets` rows) and applies verdicts as draft-state
transitions (no on-chain `approveMarket`/`rejectMarket`). What *is* reused is the *pattern*,
not the tables: content-addressed metadata (a draft review is keyed to a snapshot of the
draft's `metadataHash`, so an edit → new hash → fresh review, matching the append-only
model), the leased-job queue, and the review service itself (already stateless, takes
metadata in and returns a verdict). The published market keeps its existing review linkage
only if we later choose to copy the winning draft-review into a market-scoped audit row at
publish; the ADR does not require that.

## Review-bond escrow contract

> **Superseded — see "Amendment: prepaid review credit" below.** The reasoning for a
> standalone, submitter-keyed contract survives; the surface described here (settlement,
> withdrawal, resolver) does not.

The review bond is a **separate, standalone deployed contract** — not folded into
`PregradManager`. The existing creation fee lives as an abstract base (`CreationFeeVault`)
mixed into `PregradManager` and is keyed to `marketId`, because it is collected *inside*
`createMarket` when a market exists. The bond is different on both axes: it is collected at
**submit time, when there is no market and no `marketId`**, and it is keyed to the
**submitter**, not a market. So it does not belong in the market contract's inheritance chain
(the market contract's job is markets, not pre-market submissions), and a standalone contract
gives a clean money-trail, a tight security-audit surface (ADR 0023), and independent
evolution — mirroring the existing custody/policy split. Provisional name `ReviewBondVault`
(descriptive, per the no-third-party-names rule); it is a *prepaid refundable balance*, not a
slashable bond.

**On-chain surface (native USDC via `msg.value`):**

- `depositBond()` payable — credits `msg.value` to the caller's bonded balance
  (emits `ReviewBondDeposited`).
- `settle(user, consumedTotal, …)` `onlyResolver` — records the off-chain-metered consumed
  total and moves the newly-consumed delta from the user's bonded balance into the platform's
  collected pool (emits `ReviewFeesSettled`). The **resolver** is an owner-set key, the same
  trust model as the `createMarket` authorizer.
- `withdrawBond(amount)` — the user withdraws up to `deposited − settledConsumed`
  (emits `ReviewBondWithdrawn`). Withdrawal is gated on settlement being current — either the
  resolver settles first, or the call carries a resolver-signed `consumedTotal` — so a user
  cannot withdraw the un-settled consumed portion.
- `withdrawCollectedFees(recipient)` `onlyOwner` — platform sweeps collected review fees
  (emits `ReviewFeesWithdrawn`).

**Why metering is off-chain.** A $0.20 on-chain debit per review would cost more in gas than
the fee, and per-review transactions would reintroduce exactly the per-iteration on-chain
friction the whole draft flow removes. So the bond is **on-chain collateral**, review
consumption is **metered in the DB** against the bonded balance (submit = $1/5-reviews, then
$0.20/review), and the resolver **settles on-chain** in batches (or attests the consumed total
at withdraw). The server gates draft submission on sufficient bonded balance. This is a
prepaid-meter / one-way-channel pattern; the on-chain money events are deposit → settlement →
withdrawal, and the $0.20 granularity lives in the meter, not on-chain.

- **On-chain-first with refund-on-reject (rejected).** Keep creating on-chain in
  `UnderReview` with the fee paid up front, but make `rejectMarket` refund the fee. Rejected
  because it delivers *refunds*, not *iteration*: every retry is still a fresh on-chain
  market with new gas, and it requires a contract change to add a refund path (plus a money
  paper-trail record) while keeping the exact "created-then-rejected" experience we want to
  remove. It also keeps rejected content permanently on-chain, which is a liability, not an
  asset. A durable off-chain draft store has to be built regardless (templates cannot live
  on-chain), so building it *and* keeping on-chain-first is strictly more work.

- **Editable on-chain market during review (rejected).** "Let creators update the on-chain
  market and charge per edit" both taxes the iteration we want to encourage and contradicts
  "keep the permanent on-chain record": editing an on-chain market means adding a function
  that mutates the committed `metadataHash` mid-lifecycle, i.e. making the immutable record
  mutable. Option A gives the cleaner version — the on-chain record is written once, at
  publish, and is immutable, and exists only for real markets.

- **Platform relay publishes on approval (rejected).** One-tap, but the relay pays the fee +
  gas (so the fee stops being creator-borne, defeating its purpose), the production relay is
  currently disabled, and it reintroduces custody/keys the design deliberately avoids. Only
  "creator publishes" makes "fee on accept" mean the *creator* pays on accept.

- **Cache the publish authorization at approval time (rejected).** Simpler flow, but absolute
  deadlines baked into a cached signature go stale — a lingering approved draft becomes
  unpublishable once its `graduationDeadline` passes, and re-signing the same stale timestamp
  still reverts. Minting the authorization at publish time (over durations resolved then)
  avoids it.

- **Metadata in contract storage (deferred).** Maximally on-chain-native and readable by
  other contracts, but expensive, and unnecessary for transparency or a hash-verifying
  oracle. Deferred until an on-chain oracle design actually needs contract-readable text.

- **Per-request wallet signatures / SIWE session for draft auth (rejected for now).**
  Per-request signing is awful UX (a wallet prompt on every draft save); SIWE is a second
  auth surface independent of the wallet provider. Privy already issues a verifiable
  per-user token and the user is already logged in through it, so it is the least new
  surface. SIWE remains a fallback if we later want auth decoupled from the wallet provider.

- **Rate-limiting-only anti-spam (rejected).** Per-wallet/per-user rate limiting is not
  Sybil-resistant: SSO users get free embedded wallets, so a fresh identity is a fresh
  rate-limit bucket, and each review that clears the cheap heuristic gate spends real
  provider money. Kept only as a cheap first layer under the bond.

- **Per-submission on-chain deposit (rejected in favour of the standing bond).** A deposit
  taken on *every* submit (refunded minus a fee) is a strong deterrent but makes every submit
  and every re-submit-after-edit an on-chain tx + gas + funding — taxing exactly the iteration
  the draft flow exists to enable. The standing bond amortises that to a single on-chain
  deposit, after which iteration is metered off-chain.

- **Folding the bond into `PregradManager` / an on-chain per-review debit (rejected).** The
  bond is collected pre-market (no `marketId`) and a $0.20 on-chain debit per review costs
  more than the fee; both point to a standalone contract with off-chain metering (see
  "Review-bond escrow contract").

## Consequences

- **Creation becomes permissioned.** Public `createMarket` requires our authorizer
  signature; only owner-set trusted creators are exempt. This is an explicit product choice
  (a curated launchpad), and the authorizer key becomes security-critical infrastructure
  (rotation, custody, on-chain single-use nonce, and issuance-only-on-approval enforced
  server-side).
- **The creation fee's money paper trail is currently *missing*, and this ADR must add it.**
  `MarketCreationFeePaid` is emitted on-chain but indexed **nowhere** — no watcher, no table,
  and the fee is absent from `docs/portfolio-data-design.md`. So the fee has never had the
  event-sourced record the repo invariant requires. This ADR moves *when* the fee is
  collected (publish, not submit) **and** adds the indexing that closes the invariant (see
  P3). No refund flow is introduced (fee-on-accept removes the need for a reject refund).
- **The AI-review runner and tables are reworked, not re-pointed** (see "Draft review data
  model"): new draft-keyed tables, a runner that reads from drafts, and the deletion of the
  on-chain review path and its watcher.
- **Existing `under_review` / `rejected` on-chain markets need a migration** to a named
  surviving status. Low-stakes pre-launch, but the target status must be chosen, and the
  Postgres `market_status` enum cannot drop a value in place — retiring the labels needs a
  new type + column rewrite (after changing the `under_review` default), or the labels stay
  as dead values. The on-chain enum values must be removed **only from the tail**
  (`UnderReview`=7, `Rejected`=8) and never renumbered, because server code hand-decodes raw
  `uint8` status ordinals (`pregrad-refund.ts`, `dev-market-graduate.ts`) that ABI
  regeneration would not catch.
- **A new money contract + flow: the review-credit vault.** A standalone contract holding
  user funds. Its events must be indexed (money-invariant), and the off-chain meter is a
  correctness-critical accounting surface: under-metering leaks review cost. *(Amended: the
  resolver, on-chain settlement, and the over-metering-strands-a-refund risk are gone with
  refunds; see the amendment.)*
- **SSO users must fund their embedded wallet twice over** — review credit before submitting,
  and the creation fee + gas before publishing — a funding-UX problem to solve separately
  (onramp/faucet), out of scope here.
- **Draft content is private and mutable**, so draft endpoints are the app's first surface
  needing real authenticated writes; get the Privy JWT verification right or drafts leak.

## Money invariant

Two on-chain value flows must each leave an event-sourced DB record:

- **Creation fee.** Today it is emitted (`MarketCreationFeePaid`) but **not** indexed — no
  watcher, no table, absent from `docs/portfolio-data-design.md` — so it does not yet satisfy
  the invariant. This ADR adds a fee-events table populated by a `MarketCreationFeePaid`
  watcher keyed by `(chainId, marketId, transactionHash, logIndex)`, covered by the paper-trail
  test. Moving collection from submit to publish makes no transfer inferred or droppable; it
  *gains* the record it previously lacked.
- **Review bond.** *Amended — the flow is now deposit and owner sweep only; the settlement and
  user-withdrawal events below no longer exist.* New flow: `ReviewBondDeposited` /
  `ReviewFeesSettled` / `ReviewBondWithdrawn`
  / `ReviewFeesWithdrawn` are each indexed into their own events table keyed by
  `(chainId, user, transactionHash, logIndex)`. The **actual value transfers are the on-chain
  deposit/settlement/withdrawal**; the per-review $0.20 metering is DB accounting that nets out
  at settlement, so no value moves without an on-chain event. The off-chain meter reconciles to
  the on-chain `settledConsumed` at every settlement.

## Amendment: prepaid review credit (2026-08-04)

P3 shipped as specified above and the shipped design has been withdrawn. What follows
replaces the refundable-bond model wholesale; the rest of this ADR stands.

**What went wrong.** The escrow section above specifies withdrawal "gated on settlement being
current". The shipped `withdrawBond` is not: it checks the on-chain `settledConsumed`, which
is a lagging replica of the off-chain meter, so a creator could withdraw money covering
reviews they had already consumed. The leak is small (settlement fires at a $1 unsettled
tally, so under a dollar per wallet in normal operation) but unbounded when settlement
transactions fail. Worse, withdrawing decrements `deposited`, and `settle` reverts when the
lifetime consumed total exceeds `deposited` — so a withdrawal can wedge settlement for that
wallet permanently, leaving the server retrying and warning forever.

Both defects have one root: **the withdrawal path is on-chain and therefore cannot see the
off-chain meter.** Rather than build the machinery to close that gap — resolver-signed
withdrawal authorizations, settle-before-withdraw, or a held-back floor — we remove the
withdrawal.

**The replacement.** Review capacity is bought, not bonded:

- A creator **deposits native USDC and it is not refundable**. There is no withdrawal path
  for users; the deposit buys review runs and nothing else. This is a **prepaid credit**, not
  a bond — the word "bond" is retired (see `CONTEXT.md`).
- Deposits carry an explicit beneficiary: **`depositFor(address beneficiary)`**, never
  `msg.sender`. A creator with both an embedded wallet and an external wallet would otherwise
  be one mis-selected wallet away from an unrecoverable payment, since nothing can move a
  balance afterwards. The app always passes the draft's intended creator address. There is
  deliberately **no owner-side reassignment function** — a privileged "move user funds" call
  is a worse audit surface than the mistake it cleans up after.
- **One rate, one unit: a review run.** Each review run debits the current rate; there is no
  bundling, no first-submission surcharge, and no minimum standing balance. The $5 floor is
  redundant now that money is non-refundable — a refundable floor only ever cost an attacker
  the time-value of the deposit.
- **The rate is provisionally $0.10 per review run and is configuration, not a constant.**
  This is a *testing* rate and it is below cost: a review run measures at $0.169 on the
  claude-cli provider, so every run at $0.10 loses money and iterating loses more, which
  inverts the anti-spam incentive. Either the rate rises to $0.20+ or review moves to a
  cheaper provider before public submission opens. **Do not open public draft submission at
  $0.10.**
- Balance is priced **at spend time**, not minted as credits at deposit: the DB stores the
  deposited amount as the event reported it and debits the rate in force per run, stamping
  that rate onto each charge row. A rate change therefore reprices unspent balance —
  acceptable while testing, a fairness question to revisit before launch.

**On-chain surface** — `depositFor(address beneficiary) payable` emitting a deposit event, and
`withdrawCollectedFees(recipient)` `onlyOwner`. `settle`, `withdrawBond`, `setResolver`, the
resolver key, and the on-chain consumed-total tracking are all deleted. Since the vault is
deployed on local stacks only and appears in no infrastructure or CI configuration, this is a
rewrite rather than a migration.

**Balance reads come from the indexed database, never from a direct chain read.** The gate
computes `indexedDeposits(beneficiary) − sum(charges)`. This is the repo-wide direction —
one data source, served fast from the indexer, with the client notified by the change feed —
and it is safe here by construction: charges are written synchronously while deposits lag, so
indexer staleness can only make a balance look *too low*, never too high. The gate fails
closed without needing error handling to do it. The deposit handler must call
`recordLiveChange` so a creator who tops up is told immediately; without that the model is
fast but does not feel fast.

**Consequences of the amendment.** The off-chain meter stops being a two-way reconciliation
surface and becomes a one-way ledger: deposits in from events, charges out from reviews, no
netting and no settlement. The "over-metering strands a user's refund" risk in the
Consequences section disappears with refunds. The money invariant narrows to two events —
deposit and owner sweep — both still indexed and receipt-linked. The **operator can sweep
funds covering reviews not yet delivered**, which is inherent to prepayment and accepted at
this price point; it would need revisiting if balances grew large.

## Phased build plan

Ordered so each phase is independently shippable and the keystone (drafts + off-chain
review) lands before the contract changes. **Public draft submission does not open until the
review bond (P3) is live** — until then P2's review runs internally/allow-listed.

- [x] **P1 — Draft entity + Privy-authenticated CRUD.** Delivered 2026-08-03 as #412
      (schema) → #413 (server) → #414 (client regen) → #415 (app) → #416 (e2e).
      `market_drafts` table (content with
      relative-duration deadlines + bookkeeping columns, `is_template`, `visibility`,
      `deleted`, `owner_user_id`, `intended_creator_address`, `published_market_id`), server
      routes for create/read/update/soft-delete scoped to the **verified Privy user**, and the
      creator "my drafts" surface. Edit/iterate loop, no chain interaction yet.
      Privy JWTs are verified for real (ES256 via `jose`, fail-closed).
- [x] **P2 — Off-chain AI review on drafts.** Delivered 2026-08-03 in the same stack.
      New **draft-keyed** review + job tables and a
      reworked runner that enqueues from `market_drafts`; snapshot `metadataHash` on submit;
      user-appropriate rejection reasons; edit → re-review.
      **Divergence from the decision above:** the terminal states are
      `in_review → approved | rejected | changes_requested`, not the two this ADR
      first specified. A `manual_review` verdict maps to `changes_requested`, which
      separates *quality* ("fix this and resubmit") from *policy* (`rejected`); both
      are editable and resubmittable, so the creator-facing loop is unchanged.
- [x] **P3 — Review-bond escrow + off-chain meter.** Contract delivered as #417
      (independent of the draft stack), meter + indexing as #419. Standalone
      `ReviewBondVault` contract
      (native-USDC `msg.value`: `depositBond` / `settle`(onlyResolver) / `withdrawBond` /
      `withdrawCollectedFees`; regenerate ABIs); the off-chain fee meter ($5 min bond, $1/submit
      incl. 5 reviews, $0.20/review after) gating submission on bonded balance; the resolver
      settlement path; and indexing of the four bond events + `portfolio-data-design.md`
      entries. **Opens public draft submission.** Submission over an exhausted balance
      answers 402 and the app offers one-click deposit-and-resubmit.

      **Withdrawn 2026-08-04 — superseded by P3a** (see "Amendment: prepaid review
      credit"). Two v1 caveats were recorded here; the first is why the design was
      withdrawn rather than patched:

      - **`withdrawBond` is gated on the *settled* total, not the metered one.**
        `available = _deposited - _settledConsumed`, and `_settledConsumed` only moves
        when the resolver settles. Between settlements a creator can withdraw funds
        covering reviews they have already consumed. Recorded here as "bounded by the
        unsettled tally, roughly a dollar, priced in rather than fixed" — but that
        understated it on two counts. The bound only holds while settlement
        *succeeds*; failing settlements let the tally grow unchecked. And the same
        withdrawal decrements `deposited`, which makes `settle` revert permanently
        once the lifetime consumed total exceeds it, **wedging settlement for that
        wallet forever**. Both are removed with the withdrawal itself in P3a.
      - **The `lifecycle:e2e` lane runs unmetered.** `scripts/local-lifecycle-nightly.ts`
        never deploys the vault and its env has no `reviewBondVaultAddress`, so those
        journeys exercise draft → review → publish with the bond gate absent
        entirely; the 402-and-deposit path has no coverage there. Threading it
        through must add the field in **both** `scripts/local-dev.ts` and
        `scripts/local-dev-control.ts` — they rebuild deploy overrides
        field-by-field, so a field added to only one is silently dropped. Still open;
        carried into P3a.
- [x] **P3a — Prepaid review credit.** Delivered 2026-08-04 (#431 + the lifecycle-lane PR).
      Vault rewritten to `depositFor(beneficiary)` + `withdrawCollectedFees` (settle /
      withdrawBond / setResolver / on-chain consumption tracking deleted; ABIs regenerated).
      Meter is a one-way ledger at a single configurable per-run rate
      (`POPCHARTS_REVIEW_RUN_RATE_WAD`), reading balance from the indexed deposits scoped to
      the configured chain + vault; $5 floor, bundling, and `settledAt` dropped. The deposit
      handler signals the change feed on the beneficiary's portfolio channel. The lifecycle
      lane now boots with the vault configured and covers the funded journey end to end
      (refused → panel deposit → indexed → auto-resubmitted → approved). Deviations from the
      plan as written: the `review_bond_event_kind` enum keeps its retired values (Postgres
      cannot drop enum values in place; nothing writes them, and the meter counts only what
      the prepaid model wrote), and the app-side "notified" is a credit-endpoint poll — the
      SSE portfolio-channel subscription upgrade belongs to the live-updates slices
      (ADR 0021). An independent pre-publish review caught and fixed a concurrent-overspend
      race (wallet-scoped advisory lock), unscoped-credit leakage across deployments, and
      the migrations' silent reinterpretation of refundable-bond history. **Does not reopen
      public draft submission** — that waits on a rate at or above cost (see the amendment).
- [ ] **P4 — Gated `createMarket` + publish + creation-fee indexing.** *App half delivered*
      2026-08-03 (#415): the "Publish & pay" step, the `publishing` transient state, and the
      `published_market_id` back-link all ship. **The contract, indexer and fee-indexing work
      is open, and it is the keystone of what remains** — until it lands, on-chain
      `createMarket` stays ungated and publish bridges over it: the server calls
      `createMarket` (market born `UnderReview`) and then immediately force-approves with
      the review-manager key (`markMarketDraftPublished` → `transitionReviewedMarketOnChain`).
      That interim puts the gate in server code that has to be right on every path rather
      than in a signature check the chain enforces — one hole in it (unverified publish
      receipts) was already found and fixed in review before #415 shipped.
      Remaining — Contract: EIP-712
      authorizer signature over the **full params** with an **on-chain single-use nonce** +
      expiry, trusted-creator bypass, market **born `Active`**; regenerate ABIs. Indexer:
      project new markets as **`bootstrap`** (change `market-created.ts` + column default).
      Server: mint the publish authorization **at publish time** (re-check approved + unchanged;
      resolve durations → absolute deadlines); add the `MarketCreationFeePaid` watcher +
      fee-events table + `portfolio-data-design.md` entry. Design locked 2026-08-04 — see
      "P4 build decisions" below.
- [ ] **P5 — Retire on-chain review machinery.** Blocked on P4 — both the review-manager key
      and the on-chain review states are load-bearing for the interim publish bridge.
      Remove `UnderReview` / `approveMarket` /
      `rejectMarket` (tail-only enum removal, no renumber), the review-manager key, and the
      indexer market-review watcher; migrate existing `under_review` / `rejected` rows to a
      chosen surviving status (enum type rewrite or dead-label); audit the hand-written
      ordinal decoders.
- [ ] **P6 — Metadata from the event + display cleanup.** Populate `market_metadata` from the
      `MarketCreated` event the indexer already reads; drop the best-effort off-chain
      metadata POST.
- [x] **P7 — Templates + clone.** Delivered 2026-08-03 (#413 server, #415 app) as the
      `/studio` surface. Universal clone (own drafts / own markets / any market by
      id) → new `editing` draft, verbatim copy; `is_template` shelf; schema ready for future
      sharing.
- [ ] **P8 — Discovery filters, server-side.** Not started — `GET /markets` still takes only
      `chainId` and `since`, with no status filter. Real-markets-only board; status filters
      (Pre-grad / Graduating / Graduated / Resolving(derived, with the Graduated anti-join) /
      Resolved / Refunded / Cancelled); `markets.status` (+ timestamp) indexes; move filtering
      into SQL.

## P4 build decisions (2026-08-04)

Locked before the build. The phase entry above says *what* P4 does; this says how, on the
points where the design admitted more than one answer.

**The authorization.**

- **A new authorizer key, separate from the review-manager key.** Reusing the review-manager
  key would make P5's "remove the review-manager key" a rename rather than a removal, and
  would grow that key's blast radius at the moment we are trying to retire it.
- **Bound to the creator's address.** Only the approved creator's wallet can spend the
  authorization, so a leaked signature is inert without their wallet key. The cost is that
  publishing from a different wallet than the draft was approved under stops working; if
  that is ever wanted it is a separate feature, not a hole left open in advance.
- **Unordered single-use nonce.** Each authorization carries an arbitrary unused nonce that
  the contract marks spent. A per-creator counter is marginally cheaper but serialises
  publishing: a creator with two approved drafts, or one whose first transaction fails,
  would be blocked behind it. Several drafts in flight is the normal case the studio exists
  to support.
- **Expiry: 15 minutes.**

**Why the expiry is minutes rather than days.** Not to stop a thief — creator binding
already does that. The authorization carries **absolute** deadlines resolved from the
draft's relative durations at mint time, so its lifetime is exactly how far the market's
dates can drift from the ones the creator chose and the reviewer saw. A 90-day market
published against a month-old authorization is a 60-day market, and it does not revert:
`_validateCreateMarketParams` only rejects a `graduationDeadline` already in the past, so
full staleness is caught while partial staleness ships as a quietly wrong market. Two
smaller reasons point the same way: an outstanding authorization is a standing right to mint
that market and there is no revocation list, so the window is also how long an approval
cannot be taken back; and with a single-setter rotation (below), rotating invalidates every
outstanding authorization, so the window is the rotation blast radius. The window is cheap
because the server can mint freely — **the app must re-mint on expiry rather than surfacing
an error.** That is a requirement of choosing a short window, not an optional nicety.

**Key handling.**

- **Rotation is a single owner setter.** Accepting an outgoing and incoming key
  simultaneously would avoid mid-rotation failures, but roughly doubles the key-handling
  code to protect a 15-minute window of publishes that can simply be retried.
- **Locally the authorizer key follows the review-manager key's existing pattern** — derived
  from the local stack's dev accounts and threaded through the env writers. Per ADR 0020,
  that means **both** `scripts/local-dev.ts` and `scripts/local-dev-control.ts`, which
  rebuild deploy overrides field-by-field and silently drop a field added to only one.

**Cutover.**

- **The on-chain review runner is switched off the day P4 lands.** After P4 nothing can
  create an `under_review` market — the signature is required, and trusted creators are born
  `Active` too — so the runner has nothing left to sweep. (An earlier draft of this decision
  worried about stranding directly-created markets; that concern was wrong, because the gate
  removes the ability to create them.)
- **Existing `under_review` / `rejected` rows are testnet data and may be wiped.** P5's
  migration does not need to preserve them, which removes the enum-rewrite pressure from
  that phase.

**Shape of the work.** Small PRs split by workspace, which the contract↔indexer coupling
otherwise fights: `market-created.ts` hard-codes `status: "under_review"`, so whichever of
protocol/server lands first, `main` spends the gap recording new markets with the wrong
status. Resolved by making the indexer **read the market's real on-chain status instead of
assuming it**, which is correct under both the old contract and the new one and so can land
alone, ahead of either. That deletes the coupling rather than sequencing around it once; it
costs one extra chain read per market creation, on the rare path rather than the hot one.
The resulting order, every step independently safe:

1. **server** — `MarketCreationFeePaid` watcher + fee-events table + `portfolio-data-design.md`
   entry. Independent of the gate; pulled ahead of the rest of P4 because until it lands the
   creation fee is the one value transfer in the system with no receipt-linked record.
2. **server** — the indexer reads the market's actual on-chain status.
3. **protocol** — signature verification, nonce, expiry, authorizer setter, born `Active`;
   regenerate ABIs.
4. **server** — mint the publish authorization.
5. **scripts** — the dev authorizer key through both orchestrators and the e2e env writer.
6. **app** — re-mint transparently on expiry.

## Deferred / out of scope

- **Template sharing / public templates.** Schema is designed for it (`visibility`); the
  sharing UX and access model are not built now.
- **Metadata in contract storage** for on-chain-contract-readable question text — deferred
  to a concrete optimistic-oracle design.
- **Embedded-wallet funding** (onramp/faucet) for SSO users — needed for both the review bond
  (≥$5, before submitting) and the creation fee + gas (before publishing).
- **The `1e18`-native real-dollar peg** (protocol ADR 0009 Q1) — this ADR fixes the bond in
  the *same* native-USDC unit as the existing creation fee (so $1 = `1e18`), but whether that
  native unit is exactly $1 on Arc is the inherited open item, unchanged.
- ~~**Resolver settlement cadence for the bond**~~ — moot. The amendment removes settlement
  entirely; there is no resolver and no consumed total on chain.
- **The per-review rate at public launch**, and whether it is set by cost recovery on the
  current review provider or by moving review to a cheaper one. The $0.10 testing rate is
  below cost and must not open public submission.
- **Keyset pagination** for the discovery board (pre-existing 200-row cap) — not made worse
  by this ADR; the portfolio surface already covers claim-finding.
- **Reject-corroboration policy** (ADR 0019) still governs when an LLM-only reject is
  allowed to stand; unchanged by this ADR beyond moving it off-chain.

---

*This ADR was adversarially red-teamed (protocol/security, data-model/migration,
product/economics, money-invariant lenses) before proposal; the review data-model section,
the fee-indexing correction, publish-time authorization, the born-Active projection step, and
the identity-join specification are all folded-in findings. The anti-spam exposure the
red-team flagged is now closed by the prepaid review-bond escrow (decision 3 + the "Review-bond
escrow contract" section), replacing the earlier rate-limiting-only stance.*
