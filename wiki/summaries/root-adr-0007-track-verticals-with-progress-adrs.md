---
type: summary
title: Repo ADR 0007 — Track product verticals with progress ADRs
description: Accepted process ADR defining checklist-bearing vertical ADRs 0008–0015 and milestones M1–M5 ordering work toward the Arc Testnet launch.
sources:
  - docs/adr/0007-track-verticals-with-progress-adrs.md
updated: 2026-07-07
---

# Repo ADR 0007: Track Product Verticals With Progress ADRs

**Status: Accepted.** Dated 2026-07-06.

> **Note:** this is the canonical ADR 0007. A second file was originally filed
> under 0007 (the monorepo cleanup program); it was renumbered to **0016** on
> 2026-07-09 ([summary](root-adr-0016-monorepo-architecture-cleanup-program.md)),
> so the number is no longer shared.

## Context

Pop Charts spans four packages (`protocol/`, `app/`, `server/`, `infra/`) and
several long-running workstreams: the pregrad launchpad, AI review, the
postgrad exchange, resolution, and deployment. A July 2026 audit found the
pregrad loop working end to end on the local devchain, with remaining work in
a few well-bounded verticals. Progress toward Arc Testnet needs a durable,
reviewable home surviving individual sessions and contributors.

## Decision

Track each vertical in its own repository-level ADR containing a progress
checklist, updated in the same PR as the work it describes. A vertical is
complete when every box is checked and its exit criteria hold.

Two scoping rules across all vertical ADRs:

1. **Code functionality first.** Deploying a service or contract is never part
   of a functionality vertical; all deployment work belongs to ADR 0015.
2. **Arc Testnet is the first public target.** A security audit is out of
   scope until a mainnet plan exists.

### Vertical ADRs

0008 protocol functionality completion; 0009 server API hardening; 0010
indexer maturity; 0011 AI review service hardening; 0012 AI-assisted
resolution; 0013 app feature completion; 0014 full-lifecycle E2E testing;
0015 deployment and infrastructure.

### Milestones M1–M5

1. **M1 — Launchpad code-complete.** Pregrad loop with no manual gaps:
   productionized clearing keeper (0008), graduation UX fully wired (0013),
   unhappy-path contract coverage (0008).
2. **M2 — The exchange half.** Postgrad markets become a product: venue
   handoff verified (0008), postgrad event indexing (0010), postgrad API
   surface (0009), postgrad trading UI (0013).
3. **M3 — Resolution.** AI-assisted resolution service (0012) and redemption
   UX (0013).
4. **M4 — Hardening and proof.** Service auth and security (0009, 0011),
   full-lifecycle happy and unhappy path E2E suites (0014).
5. **M5 — Deployment (final).** All of ADR 0015; deploying the protocol to
   Arc Testnet is the final step of the final milestone.

## Consequences

Progress is visible in-repo and reviewable in PRs; scope boundaries are
written once. Tradeoffs: checklists drift if PRs forget to update them
(reviewers must treat a stale checklist as a review defect — a drift already
observed in the cleanup program's E7 item), and these ADRs record plans as
well as decisions, stretching the classic ADR form.

## Related pages

- [../concepts/market-lifecycle.md](../concepts/market-lifecycle.md)
- [../concepts/deployment-and-infrastructure.md](../concepts/deployment-and-infrastructure.md)
- [../concepts/testing-strategy.md](../concepts/testing-strategy.md)
- Vertical summaries: [0008](root-adr-0008-protocol-functionality-completion.md),
  [0009](root-adr-0009-server-api-hardening.md),
  [0010](root-adr-0010-indexer-maturity.md),
  [0011](root-adr-0011-ai-review-service-hardening.md),
  [0012](root-adr-0012-ai-assisted-resolution.md),
  [0013](root-adr-0013-app-feature-completion.md),
  [0014](root-adr-0014-full-lifecycle-e2e-testing.md),
  [0015](root-adr-0015-deployment-and-infrastructure.md)
