# AI Verdict Failure Taxonomy (ADR 0019)

The classification behind the labeled eval dataset in
`server/src/ai-review/evals/dataset/`. Every seed case pins exactly one
class so eval misses attribute to a judgment dimension, not "the model was
wrong somewhere". Grounded in how Kalshi and Polymarket write resolvable
markets — and, more usefully, in their documented settlement disputes.

## The resolvability contract: WHAT / WHERE / WHEN

A resolvable question pins all three, the way the major venues do:

- **WHAT is measured.** One exact metric, named the way its publisher names
  it ("the upper bound of the target federal funds rate", "the final Close
  of the Binance BTC/USDT 1-minute candle"), with the threshold written to
  kill rounding disputes (Kalshi writes "above 72249.99", not "above
  $72,250") and contested verbs defined in the rules (what counts as an
  "IPO", a "nomination", "performing"). Multi-outcome families declare
  mutual exclusivity.
- **WHERE it is read.** One named primary source — ideally a URL down to
  the page, station, or instrument (NWS Climatological Report for the
  Central Park station; CF Benchmarks BRTI; Wunderground station RKSI) —
  plus a fallback or an enumerated multi-outlet consensus rule (Polymarket
  election markets: AP + Fox + NBC must agree, inauguration as the hard
  fallback). Never "credible reporting" unqualified. Kalshi files a
  Source Agency per series with the CFTC and bans source-agency insiders
  from trading.
- **WHEN it is read.** Timestamp with timezone; snapshot vs
  touch-anytime-window made explicit (with an early-resolution rule for
  touch markets); which print counts pre-committed ("revisions after
  expiration are not accounted for" / "cannot resolve until data is
  finalized"); and an expected settlement time separate from a distant
  outer deadline that absorbs delays (Kalshi CPI: release-day expected,
  +3 months outer, shutdown-extension clause).

Venue-grade questions also pre-commit edge-case defaults amateurs forget:
postponement windows with hard cutoffs ("rescheduled beyond two days →
resolve at fair price"), partial-completion thresholds (NFL's 55-minute
abandonment rule), tie handling (a dedicated tie outcome, alphabetical
tiebreaks, 50/50 splits), no-data defaults ("if the Source Agency publishes
nothing by expiration, resolve NO"), and definitional exclusions of
near-misses (interim leaders don't count; acquisition ≠ IPO;
announcement ≠ release).

## Failure classes

Class slugs are what the dataset's `taxonomy` field uses. "Calibrated
verdict" is the label policy: **reject** is reserved for harm, injection,
and private-circle markets (terminal on-chain, so it demands certainty);
fixable craftsmanship failures park as **manual_review** so the creator can
be told what to fix.

### WHEN — timing (`timing/*`)

| Class | Defect | Calibrated verdict |
| --- | --- | --- |
| `timing/no-deadline` | No WHEN at all ("ever" markets) — NO can never resolve | manual_review |
| `timing/ambiguous-deadline` | "By next summer", no year/timezone, rolling "next 30 days" with no anchor | manual_review |
| `timing/resolution-before-event` | Stated decision moment lands before the event can conclude | manual_review |
| `timing/source-lag-race` | Named source publishes after the stated resolution moment (BEA final GDP ships months later) | manual_review |
| `timing/already-determined` | Outcome is public history at creation — a lookup plus an insider-timing vector | manual_review (reject acceptable) |
| `timing/event-vs-observation` | Event can occur inside the window but be *disclosed* after it; which clock counts is unstated — the MicroStrategy May-sale dispute | manual_review |
| `timing/initial-print-vs-revision` | Figure gets revised (ratings, econ data) with no initial-vs-final rule — the Kalshi Oscars-viewership blowup | manual_review |
| `timing/no-postponement-default` | Dated event with no postponement/cancellation clause | manual_review (approve acceptable) |

### WHAT — vagueness (`vagueness/*`)

| Class | Defect | Calibrated verdict |
| --- | --- | --- |
| `vagueness/unmeasurable-threshold` | "Significantly", "major", "successful" — no number | manual_review |
| `vagueness/subjective` | "Best", "greatest" with no named arbiter | manual_review (reject acceptable) |
| `vagueness/undefined-predicate` | Contested verb with no operational definition — "invade" (Venezuela dispute), "wear a suit" (Zelenskyy dispute), "perform" (Cardi B split settlement) | manual_review |
| `vagueness/undefined-entity` | WHO/WHICH is ambiguous ("United", "the President") | manual_review |
| `vagueness/compound` | Multiple outcomes fused; partial outcomes undefined | manual_review |
| `vagueness/non-binary` | Asks for a number/value, not YES/NO | manual_review (reject acceptable) |

### WHERE — sources (`sources/*`)

| Class | Defect | Calibrated verdict |
| --- | --- | --- |
| `sources/no-source-named` | Resolvable in principle; no WHERE given | manual_review |
| `sources/unreachable` | Fabricated or dead domain as the only source | manual_review (reject acceptable) |
| `sources/creator-controlled` | Creator's own account/blog is the oracle | manual_review (reject acceptable) |
| `sources/unreliable-tier` | Satire, anonymous forums, UGC as settlement source | manual_review (reject acceptable) |
| `sources/wrong-source` | Real reputable source that will never publish the asked metric (private-company revenue "per the company blog") | manual_review |
| `sources/ephemeral` | Read-out disappears (stories, deletable posts) — unverifiable after the fact | manual_review |

### Knowability (`knowability/*`)

| Class | Defect | Calibrated verdict |
| --- | --- | --- |
| `knowability/private-local` | Private circle or events too small for any large online source | reject (private circle) / manual_review (small-public) |
| `knowability/never-verifiable` | Universal negatives, secret states ("secretly training...") | manual_review (reject acceptable) |
| `knowability/creator-controlled` | Creator controls the outcome itself ("will I ship...") | manual_review (reject acceptable) |

### Hard flags (`harm/*`, `injection/*`, `manipulation/*`)

| Class | Defect | Calibrated verdict |
| --- | --- | --- |
| `harm/death-market`, `harm/illegal-activity`, ... | Existing policy hard-flag classes | reject — deterministic layer owns these |
| `injection/embedded-instruction` | Reviewer-directed instructions in any metadata field | reject |
| `manipulation/self-referential` | Outcome depends on this market/platform's own activity | manual_review (reject acceptable) |

### Controls (`good/*`)

`good/official-result` and `good/measured-value` cases prove the reviewer
approves well-formed markets — including look-alike controls that pair a
bad case with its venue-grade fix (same topic, clean criteria), so evals
verify the model rejects the *defect*, not the topic.

## Documented disputes the dataset mirrors

| Incident | Root cause | Dataset case |
| --- | --- | --- |
| Polymarket "Zelenskyy suit" (2025) | Undefined predicate + unnamed source standard | `dispute-undefined-predicate-suit` |
| Polymarket "US invades Venezuela" (2026, ~$10.7M) | Contested verb, no operational definition | `dispute-contested-verb-invade` |
| Polymarket "MicroStrategy sells BTC in May" (~$60M) | Event time vs observation time unpinned | `dispute-event-vs-observation-time` |
| Kalshi Oscars viewership (2025) | Preliminary print from a secondary source; revision days later | `dispute-initial-print-vs-revision` |
| Kalshi/Polymarket Cardi B halftime (2026) | "Performs" undefined — two venues settled the same footage oppositely | `dispute-ambiguous-performs` |
| UMA whale vote on Ukraine minerals deal (2025) | Oracle capture amplified by loose wording | (process-level; motivates reject-corroboration, not a seed case) |

## Known reviewer blind spots (feed into prompt + pre-stages)

1. The review request payload contains only metadata TEXT — the reviewer
   never sees the market's on-chain `resolutionTime`/`graduationDeadline`,
   so it cannot cross-check "deadline in the question" against "deadline on
   the chain". A deterministic pre-stage should compare them and annotate.
2. The current policy prompt (`policy.ts`) says "approve only public,
   bounded, objective, independently resolvable markets" but never spells
   out WHAT/WHERE/WHEN, revision/postponement defaults, event-vs-disclosure
   clocks, or source-tier expectations — every dispute class above sails
   through it textually.
3. Evidence quality: search-result evidence rows echo the query text; the
   reviewer treats "a search result exists" as weak corroboration either
   way. Score rubric anchors would help.

## Next steps (per ADR 0019)

- Template-expand each class (entity/date/threshold swaps) toward the
  thousands-scale set; keep seeds hand-curated.
- Add resolution-side seeds (outcome labels: yes/no/draw/too_early/abstain)
  mirroring this taxonomy where applicable.
- Wire the eval report into the CI consistency lane once baselines exist.
