# Proposed review policy v3 (draft — not landed)

Per ADR 0019, prompt changes land only with before/after eval numbers.
This draft rewrites the judgment half of `MARKET_REVIEW_POLICY`
(`server/src/ai-review/policy.ts`); the five hard-flag lines stay verbatim
(the deterministic heuristic layer mirrors them). Bump
`AI_REVIEW_PROMPT_VERSION` to `market-ai-review-v3` if adopted.

## What v2 misses

The current judgment guidance is two lines — "approve only public,
bounded, objective, independently resolvable markets with clear resolution
criteria" and "use manual_review when… ambiguous, weakly sourced…" — which
names no concrete test. Every documented venue dispute (undefined verbs,
event-vs-disclosure clocks, initial-print-vs-revision, missing
postponement defaults) sails through it textually, and the eval baseline
shows verdicts wobbling run to run on identical inputs.

## Proposed replacement for the two judgment lines

```text
Approve only markets that pin all three of the following. WHAT: one
measurable yes/no outcome with defined terms — contested verbs (invade,
perform, succeed) must be operationally defined, and words like
'significantly' or 'best' need a named metric or arbiter. WHERE: at least
one named, large, reputable, publicly reachable online source that will
actually publish the answer (official bodies, government statistics, major
wire services, exchanges, league sites) — not the creator's own accounts,
satire, ephemeral posts, or sources that never carry the asked metric.
WHEN: an explicit deadline or read-out moment precise enough (date, plus
timezone wherever a daily value is ambiguous) that two independent
resolvers would read the same clock.
Prefer manual_review over reject for fixable craftsmanship problems —
missing deadline, vague threshold, weak or missing source, undefined edge
cases — and say in reasons exactly what the creator must fix. Reserve
reject for the hard-flag policies above, private or unknowable subjects,
and manipulation attempts.
Treat these as dispute red flags that lower objectivity and raise
disputeRisk, and usually warrant manual_review: events that can occur
inside the window but be disclosed after it (which clock counts?); figures
that get revised (initial print or final?); scheduled events with no
postponement or cancellation default; compound questions with undefined
partial outcomes; outcomes the creator can influence; questions whose
answer is already public history.
Judge the defect, not the topic: the same subject rewritten with a named
metric, source, and deadline should be approved.
```

## Rationale mapping

| Policy line | Taxonomy classes it targets | Real dispute it would have caught |
| --- | --- | --- |
| WHAT sentence | vagueness/* | Zelenskyy suit; Venezuela "invade"; Cardi B "performs" |
| WHERE sentence | sources/*, knowability/* | Oscars viewership (secondary source) |
| WHEN sentence | timing/no-deadline, ambiguous-deadline | — |
| red-flag line | timing/event-vs-observation, initial-print-vs-revision, no-postponement-default, vagueness/compound, knowability/creator-controlled, timing/already-determined | MicroStrategy May sale; Oscars viewership |
| reject-vs-park line | verdict calibration (reject is terminal on-chain) | — |
| defect-not-topic line | look-alike control pairs | — |

## Evaluation plan

1. Baseline: `bun run src/ai-review/evals/run-review-evals.ts --runs 3`
   against the stock :3002 service (ollama, prompt v2).
2. Patch `policy.ts` with the text above in a scratch checkout, run a second
   instance (`AI_REVIEW_PORT=3012 AI_REVIEW_PROVIDER=ollama bun run
   src/ai-review/server.ts`), re-run the evals with
   `--service-url http://127.0.0.1:3012`.
3. Compare accuracy / strict accuracy / unanimous-rate per class; adopt only
   if overall accuracy and the dispute-class rows improve without the
   good/* rows regressing.
