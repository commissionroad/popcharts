---
type: summary
title: AI Verdict Failure Taxonomy (docs/ai-verdict-failure-taxonomy.md)
description: The failure classification behind the ADR 0019 eval dataset — the WHAT/WHERE/WHEN resolvability contract distilled from Kalshi/Polymarket practice, failure classes with calibrated verdicts, six documented settlement disputes mapped to seed cases, and known reviewer blind spots.
sources:
  - docs/ai-verdict-failure-taxonomy.md
updated: 2026-07-15
---

# AI Verdict Failure Taxonomy

Dated 2026-07-14/15. First artifact of the
[ADR 0019 verdict-quality program](root-adr-0019-ai-verdict-quality-program.md):
the classification that every labeled case in
`server/src/ai-review/evals/dataset/` pins to, so eval misses attribute to a
specific judgment dimension.

## The resolvability contract

A resolvable question pins **WHAT** (one exact metric, publisher-named, with
thresholds written to kill rounding disputes and contested verbs
operationally defined), **WHERE** (a named large reputable source that will
actually publish the answer — URL down to the page/station/instrument, with
a fallback or an enumerated multi-outlet consensus rule), and **WHEN** (a
timestamp with timezone; snapshot vs touch-window explicit; initial print vs
revision pre-committed; an expected settlement time plus an outer deadline).
Distilled from Kalshi's CFTC-filed Source Agency + secondary-rules
discipline and Polymarket's source/end-date/edge-cases template.

## Failure classes

Grouped as `timing/*` (no deadline, ambiguous deadline, source-lag race,
already-determined, event-vs-observation clock, initial-print-vs-revision,
no-postponement-default), `vagueness/*` (unmeasurable threshold, subjective,
undefined predicate, undefined entity, compound, non-binary), `sources/*`
(none named, unreachable, creator-controlled, unreliable tier, wrong source,
ephemeral), `knowability/*` (private/local, never-verifiable,
creator-controlled), plus hard-flag classes (`harm/*`,
`injection/*`, `manipulation/*`) and `good/*` controls including look-alike
pairs. Label policy: **reject** is reserved for harm/injection/
private-circle (terminal on-chain); fixable craftsmanship failures park as
**manual_review**.

## Grounding in real disputes

Six documented venue disputes map to seed cases: Zelenskyy suit (undefined
predicate), Venezuela "invade" (contested verb), MicroStrategy May sale
(event vs disclosure clock), Kalshi Oscars viewership (initial print vs
revision), Cardi B halftime (same footage, opposite settlements), and the
UMA whale vote (process-level; motivates reject-corroboration).

## Reviewer blind spots recorded

The review request payload lacks the market's on-chain
resolutionTime/graduationDeadline (a deterministic pre-stage should
cross-check); prompt v2's judgment guidance named no concrete test (fixed by
the v3 policy adopted with eval numbers in the same PR); search-result
evidence rows are low-information query echoes.

## Related pages

- [Root ADR 0019 — verdict quality program](root-adr-0019-ai-verdict-quality-program.md)
- [Testing strategy](../concepts/testing-strategy.md) ("AI verdict evals")
- [AI review service](../entities/ai-review-service.md)
- [AI-assisted resolution](../concepts/ai-assisted-resolution.md)
