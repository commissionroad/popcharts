---
type: summary
title: Whitepaper history — v0.1 through v0.6
description: Evolution of the mechanism papers — v0.1's price-bucket batch auction, v3's pivot to path-overlap clearing, v4's full spec, v0.5's solvency proof, and v0.6's withdrawals and fees
sources:
  - whitepaper/README.md
  - whitepaper/v0.1.md
  - whitepaper/v0.2.md
  - whitepaper/v0.3.md
  - documents/whitepaper_v0_1.pdf
  - documents/whitepaper_v3.pdf
updated: 2026-08-05
---

# Whitepaper history — v0.1 through v0.3

Superseded drafts of the mechanism paper precede
[whitepaper v4](whitepaper-v4.md), and two revisions follow it — see the tail
of this page for v0.5 and [v0.6](whitepaper-v6.md), the current source of
truth. Per protocol ADR 0002 they are **context
only**: useful for lifecycle vocabulary and oracle/resolution modularity, but
v4 supersedes their clearing mechanics.

**The full ladder is now in-repo.** The markdown sources were imported
2026-08-04 alongside the MathJax build, so `whitepaper/v0.1.md` … `v0.6.md`
are the authority and `documents/*.pdf` are rendered artifacts (the schema's
raw-source layer says so explicitly). That resolves the file-naming quirk this
page previously flagged: the PDF set was ambiguous because
`whitepaper_v3.pdf` is internally labeled **"WORKING DRAFT, rev. 0.2"** (May
2026) while `whitepaper_v0_1.pdf` carries no rev label (May 27, 2026). The
markdown ladder separates v0.2 and v0.3 as distinct revisions (911 and 629
lines), so *internal* revision numbers — not PDF filenames — are the reliable
identifier. One more marker of the ladder: v0.1–v0.5 are titled
"PredictFun White Paper"; the rename to **"Pop Charts White Paper"** happens at
v0.6.

## v0.1 — price-bucket batch auction (May 27, 2026)

_PredictFun: A No-Subsidy Prediction Market Launchpad_ (15 pages). Already in
place: the core thesis (LMSR pricing without subsidy; pre-graduation bets are
provisional receipts, not outcome tokens; only cleared exposure becomes
CTF-style claims; unmatched demand refunds), the LMSR state offset for opening
at any prior, budget-entry inversion, the graduation threshold on filled
market cap `F`, and the comparison table against subsidized LMSR /
pari-mutuel / order book / CPMM.

What differed — all later discarded:

- **Compatibility was price-bucket, not path.** A YES lot at entry price
  `p_y` and a NO lot at `p_n` were matchable iff `p_y + p_n >= 1` (§6).
  Receipts were "bucketed by side and entry price," i.e. treated as
  uniform-average-price blocks.
- **Clearing was a sorted batch auction** (§7): sort YES lots by descending
  `p_y`, NO lots by descending `p_n`, match while `p_y + p_n >= 1`, retain
  `f = min(remaining)` per pair — favoring the most price-compatible demand
  rather than treating overlap symmetrically.
- **Surplus and price improvement.** A matched pair with `p_y + p_n > 1`
  produced surplus collateral, returned to bettors as price improvement (or
  optionally routed into post-grad liquidity). Design goal 4 was "locked or
  improved fill odds." v4 has no surplus concept at all — every slice settles
  at exactly its recorded path price.
- **Resolution was in scope** (§12): an optimistic pipeline — AI resolver
  proposes YES/NO/CANCEL with an evidence bundle, a challenge window, bonded
  disputes escalating to human review, then a UMA-style arbitration backstop.
  This is the origin of the repo's
  [AI-assisted resolution](../concepts/ai-assisted-resolution.md) design; v4
  drops the whole section as a modular layer.
- **Market rule schema** (§13): a canonical JSON rule spec (question,
  yes/no criteria, end time, resolution deadline, primary/fallback sources,
  source-priority, too-early, cancellation, and evidence-requirement rules)
  "to prevent the market maker from becoming the court."
- Only two lifecycle phases (pre-graduation, graduation) and five design
  goals.

## v3 (rev 0.2) — the pivot to path-overlap clearing (May 2026)

Same title, 20 pages. This draft contains the decisive mechanism change and
most of the lifecycle vocabulary the repo still uses.

- **Path-overlap clearing replaces price buckets.** The clearing primitive
  becomes the LMSR path segment on `r = q_yes − q_no`: receipts record LMSR
  state before/after and hence an interval `[r_low, r_high]` of width `s`;
  two receipts match only over the positive-width intersection of their
  intervals (§7). The endpoint-sweep algorithm, band coverage counts,
  `m_k = min(Y_k, N_k)`, scarce-side-full / crowded-side-pro-rata retention,
  dust-band skipping, and the band identity `L_k = m_k · w_k = F_k` all
  appear here in essentially their v4 form (§8), along with the solvency
  theorem `E = R + L`, `L = F` (§9) and the explicit
  "why average-price matching is insufficient" argument.
- **Seven design goals**, adding explicit provisionality, deterministic
  lifecycle, and cost-basis-preserving partial fills to v0.1's five.
- **A full lifecycle state machine** (§5): `Draft → Approved → PreGradOpen →
  FrozenForClearing → Graduated | NotGraduated | Canceled`, with a
  creator-review stage, a **creator bond** posted at approval (with penalty on
  cancellation), per-market deadlines (`pregrad_open_time`,
  `pregrad_close_time`, `event_end_time`, `resolution_deadline` — graduation
  must not happen after the outcome is knowable), permissionless freezing
  once eligible, and non-price eligibility gates (rule-quality, time
  remaining, concentration). v4 compresses this to
  open → frozen → graduated/not-graduated and pushes the rest out of scope;
  the richer v3 state vocabulary survives in the repo's
  [market lifecycle](../concepts/market-lifecycle.md).
- **Receipt rights formalized** (§6): three rights (participate in clearing,
  receive retained tokens, refund of unretained cost basis) and the
  non-rights list, including non-transferability and no voluntary withdrawal
  — carried into v4 nearly verbatim. v3 adds that escrowed receipt collateral
  can never be used as creator bond, resolver bond, insurance capital, or
  protocol working capital: its only two destinations are refund or locked
  collateral.
- **Fees explicitly deferred**: the design "intentionally omits trading
  fees"; if added they must appear as `E = R + L + fees` with a stated charge
  point — language v4 keeps.
- **Resolution and rule schema retained** from v0.1 (optimistic AI resolver +
  challenge + UMA-style escalation; canonical rule spec), plus a risks
  section (fill misunderstanding, one-sided refund events, path-incompatible
  demand, manipulated graduation, resolution failure, ambiguous markets).
- Worked example: Alice YES 50→60%, Bea YES 60→70%, Noah NO 70→65% — only
  the 65–70% band (width ≈ 22.8259) matches; Alice refunds fully.

## v3 → v4: what changed in the current source of truth

v4 (rev 0.4, June 2026) renames and reframes rather than re-deriving:

- **"Band-pass graduation clearing"** replaces "path-overlap clearing";
  **"virtual LMSR"** becomes the headline framing (state = demand-pricing
  state, `b` = virtual smoothness); receipts are consistently "priced
  intents" and get the strip-of-tiny-limit-orders explanation.
- **Scope narrows**: the Draft/Approved review stage, creator bond, market
  rule schema, and the entire resolution section are dropped as modular
  layers outside the paper. The clearing/solvency math is unchanged.
- **New analysis**: §5 "Why Aggregate Matching Fails" (five rejected
  shortcuts); §8 fill-outcome table with effective-price bounds
  (`[P(u), P(v)]`) and payoff bounds; an explicit time-symmetry discussion
  (FIFO as a possible alternative policy); two richer worked examples
  including the paint-the-curve / "large drift is not backfilled" example;
  and a named open-questions list (per-market `b` selection, threshold
  sizing, onchain rounding policy, anti-manipulation gates, receipt
  transferability).

Net: the solvency mechanism has been stable since rev 0.2; v4 is the sharper,
narrower statement of it. Anything about market review, creator bonds,
deadlines beyond the close time, rule schemas, or resolution now rests on the
superseded drafts (and on protocol ADRs), not on the current whitepaper.

## Related pages

- [Whitepaper v4 summary](whitepaper-v4.md)
- [Mechanism whitepaper](../concepts/mechanism-whitepaper.md)
- [Market lifecycle](../concepts/market-lifecycle.md)
- [Graduation clearing](../concepts/graduation-clearing.md)
- [AI-assisted resolution](../concepts/ai-assisted-resolution.md)

## v0.5 — the solvency proof (June 2026, unpublished)

A ~25% shorter rewrite of v0.4 whose substantive change is §6: the informal
conservation argument becomes **Lemma 1** (local funding identity, from
`P_yes + P_no = 1` on every band), **Lemma 2** (balanced complete sets), and an
exact-collateralization **Theorem** (`L = F`, zero deficit and zero surplus),
plus a tightness argument showing overlap is necessary *and* sufficient for a
segment to be retainable. Never rendered to a PDF and never referenced by an
ADR; it lived only in a `predictfun` worktree until the 2026-08 import.

## v0.6 — withdrawals, fees, seeding (August 2026, current)

v0.5 plus three things, and the rename from PredictFun to Pop Charts:
lock-the-overlap withdrawals with **Lemma 3** (`F` is invariant under
withdrawal of unopposed bands), fees as an explicit `E = R + L + Φ` term, and
fee-funded seeding of the post-graduation pools. Full digest:
[whitepaper v0.6](whitepaper-v6.md). This is the first revision to live in the
repo as markdown ([`whitepaper/`](../../whitepaper/README.md)) rather than only
as a PDF.

Naming quirk, restated: file version numbers and internal revision labels only
line up from v4 onward. `whitepaper_v3.pdf` is internally rev 0.2;
`whitepaper_v4.pdf` is rev 0.4 and its markdown source is `v0.4.md`; v0.5 and
v0.6 exist only as markdown.
