# Review-first market creation: off-chain drafts, gated on-chain publish, and creator surfaces

Status: Proposed

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

1. **Draft is a new off-chain entity** (its own table), distinct from a `Market`. Its
   *content* mirrors the `createMarket` params (question, description, resolution criteria,
   resolution sources, category, collateral, opening probability, liquidity parameter,
   graduation threshold, graduation deadline, resolution time). Its *bookkeeping* columns
   add: id, owner (Privy user), intended creator wallet address, `status`, `is_template`,
   `visibility`, `deleted` (soft-delete), timestamps (created / updated / submitted /
   reviewed / published), the issued **publish authorization** + its expiry,
   `published_market_id` (set once live), and a pointer to the latest rejection's reasons.
   Drafts **linger forever**; a user can soft-delete (`deleted`) to hide them.

2. **Draft lifecycle:**

   ```
   editing ──submit──▶ in_review ──reject──▶ rejected ──edit──▶ editing
      ▲ (templates                │
        live here)                └──approve──▶ approved ──publish&pay──▶ published
                                                                             │
                                                              (on-chain Market born Active;
                                                               draft retained, linked, cloneable)
   deleted = soft-delete flag, valid from any state
   ```

3. **Fee-on-accept.** No fee and no gas are charged until publish. The existing on-chain
   creation fee is paid by the creator when they publish (`createMarket`). Rejected and
   iterated drafts cost nothing. Anti-spam moves off the fee (which no longer gates the
   door) onto **per-wallet/per-user rate limiting** for now.

4. **The creator publishes** (not a platform relay). Approval issues a **publish
   authorization**; the creator returns, signs `createMarket`, and pays the fee + gas.
   Approved-but-unpublished drafts linger; an expired authorization is re-issued while the
   draft is still approved, and any edit sends the draft back through review.

5. **On-chain creation is gated by an authorizer signature.** `createMarket` gains a
   creation authorization: an EIP-712 signature from an owner-set **authorizer** key,
   binding the creator (`msg.sender`), the exact params / `metadataHash`, a nonce, and an
   expiry. Without a valid, matching, unexpired signature the call reverts — so there is no
   direct-to-contract path that skips review. **Trusted creators (owner-set
   `isTrustedCreator`) bypass the signature entirely** (as they already bypass the fee).
   This is the path for vetted parties to create without our per-draft approval; there are
   none yet, but the mechanism must exist.

6. **Retire the on-chain review states.** Because a market can only be created *after*
   off-chain approval, it is born **`Active`** (projected `bootstrap`). We remove the
   on-chain `UnderReview` status, `approveMarket` / `rejectMarket`, the review-manager key,
   and the indexer's market-review watcher. AI review lives entirely off-chain, on drafts.
   This is a deliberate shift from **permissionless creation + post-hoc review** to
   **permissioned creation gated by review**.

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
   address-in-query (which would let anyone read, edit, or delete another user's drafts).
   The server verifies the Privy-issued JWT and scopes drafts to the Privy user. This works
   identically for **EOA** users (external wallet linked to Privy) and **SSO** users
   (embedded wallet from social/email login) — both get a verifiable token; the linked
   wallet (external or embedded) is what later signs the publish transaction.

9. **Templates.** A universal **clone** action seeds a new `editing` draft, pre-filled from
   any source: one of your drafts, one of your published markets, or **any market by pasted
   id**. Clone copies content **verbatim** (the creator fixes date fields themselves).
   `is_template` is an organizational shelf label — a template is a normal draft you keep to
   clone from. The schema carries a `visibility` field so templates can later be **shared**;
   sharing is not built initially (private-only).

10. **Creator surfaces.** A separate wallet-scoped area shows the user's own drafts,
    rejected drafts, templates, and published markets. The **public discovery board shows
    real markets only** — drafts, rejected, and under-review never appear (and
    `under_review` ceases to exist on-chain).

11. **Discovery filters** over the remaining lifecycle: **Pre-grad** (the `bootstrap`
    status), **Graduating**, **Graduated**, **Resolving** (derived — a `graduated` market
    with an in-flight resolution job, mirroring how under-review progress is derived today),
    **Resolved**, plus terminal **Refunded** and **Cancelled** (included so users can still
    find markets they need to claim refunds or redemptions from). Filtering moves
    server-side, which needs a btree index on `markets.status` (and likely
    `markets.created_block_timestamp` for the existing `ORDER BY`) — neither exists today.

## Considered options

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

- **Metadata in contract storage (deferred).** Maximally on-chain-native and readable by
  other contracts, but expensive, and unnecessary for transparency or a hash-verifying
  oracle. Deferred until an on-chain oracle design actually needs contract-readable text.

- **Per-request wallet signatures / SIWE session for draft auth (rejected for now).**
  Per-request signing is awful UX (a wallet prompt on every draft save); SIWE is a second
  auth surface independent of the wallet provider. Privy already issues a verifiable
  per-user token and the user is already logged in through it, so it is the least new
  surface. SIWE remains a fallback if we later want auth decoupled from the wallet provider.

## Consequences

- **Creation becomes permissioned.** Public `createMarket` requires our authorizer
  signature; only owner-set trusted creators are exempt. This is an explicit product choice
  (a curated launchpad), and the authorizer key becomes security-critical infrastructure
  (rotation, custody, and issuance-only-on-approval must be enforced server-side).
- **The money paper trail is preserved.** The fee is still collected on-chain in
  `createMarket` and still emits `MarketCreationFeePaid`, indexed to a DB record — the fee
  simply moves from submission-time to publish-time. No new refund flow is introduced (fee-
  on-accept removes the need for a reject refund), so no new value transfer needs trailing.
- **The AI-review runner is re-pointed at drafts.** Reviews stay keyed to a snapshotted
  `metadataHash` (edit → new hash → re-review), reusing the existing append-only, hash-keyed
  machinery; the half-built `/api/market-review/submissions` intake is the front half of it.
  The on-chain review path and its watcher are deleted.
- **Existing `under_review` / `rejected` on-chain markets need a migration.** Low-stakes
  pre-launch, but the transition (and the removed enum values) must be handled deliberately.
- **SSO users must fund their embedded wallet** with the fee + gas before they can publish —
  a funding-UX problem to solve separately (onramp/faucet), out of scope here.
- **Draft content is private and mutable**, so draft endpoints are the app's first surface
  needing real authenticated writes; get the Privy JWT verification right (issuer, audience,
  expiry, signature against Privy's keys) or drafts leak.

## Money invariant

The creation fee remains an on-chain value transfer that leaves an immutable,
event-sourced DB record (`MarketCreationFeePaid` → indexed), satisfying the repo money
paper-trail invariant. This ADR moves *when* that transfer happens (publish, not submit);
it does not make any value transfer inferred, off-chain, or droppable.

## Phased build plan

Ordered so each phase is independently shippable and the keystone (drafts + off-chain
review) lands before the contract change.

- [ ] **P1 — Draft entity + Privy-authenticated CRUD.** `market_drafts` table (content +
      bookkeeping columns, `is_template`, `visibility`, `deleted`), server routes for
      create/read/update/soft-delete scoped to the verified Privy user, and the wallet-scoped
      "my drafts" surface. Edit/iterate loop, no chain interaction yet.
- [ ] **P2 — Off-chain AI review on drafts.** Re-point the review runner (and the
      `/api/market-review/submissions` intake) at drafts; snapshot `metadataHash` on submit;
      `in_review → approved | rejected`; surface user-appropriate rejection reasons; edit →
      re-review. Still no chain change (approval does not yet publish).
- [ ] **P3 — Gated `createMarket` + publish authorization.** Contract: EIP-712 authorizer
      signature (nonce + expiry), trusted-creator bypass, market born `Active`; regenerate
      ABIs. Server: issue the publish authorization on approval; verify at publish. App: the
      creator "Publish & pay" step; link `published_market_id` back to the draft.
- [ ] **P4 — Retire on-chain review machinery.** Remove `UnderReview` / `approveMarket` /
      `rejectMarket`, the review-manager key, and the indexer market-review watcher; migrate
      existing `under_review` / `rejected` rows.
- [ ] **P5 — Metadata from the event + display cleanup.** Populate `market_metadata` from
      the `MarketCreated` event the indexer already reads; drop the best-effort off-chain
      metadata POST.
- [ ] **P6 — Templates + clone.** Universal clone (own drafts / own markets / any market by
      id) → new `editing` draft, verbatim copy; `is_template` shelf; schema ready for future
      sharing.
- [ ] **P7 — Discovery filters, server-side.** Real-markets-only board; status filters
      (Pre-grad / Graduating / Graduated / Resolving(derived) / Resolved / Refunded /
      Cancelled); `markets.status` (+ timestamp) indexes; move filtering into SQL.
- [ ] **P8 — Anti-spam rate limiting** on draft submission / review enqueue.

## Deferred / out of scope

- **Template sharing / public templates.** Schema is designed for it (`visibility`); the
  sharing UX and access model are not built now.
- **Metadata in contract storage** for on-chain-contract-readable question text — deferred
  to a concrete optimistic-oracle design.
- **Embedded-wallet funding** (onramp/faucet) for SSO creators at publish time.
- **Fee denomination sign-off** (the `1e18` native vs 6-decimal USDC question, protocol
  ADR 0009 Q1) — inherited open item, not resolved here.
- **A better anti-spam mechanism** than rate limiting (e.g. refundable deposit) — revisit
  at adoption scale.
- **Reject-corroboration policy** (ADR 0019) still governs when an LLM-only reject is
  allowed to stand; unchanged by this ADR beyond moving it off-chain.
