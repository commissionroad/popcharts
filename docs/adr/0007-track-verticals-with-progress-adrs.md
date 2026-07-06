# ADR 0007: Track Product Verticals With Progress ADRs

Status: Accepted

Date: 2026-07-06

## Context

Pop Charts spans four packages (`protocol/`, `app/`, `server/`, `infra/`) and
several long-running workstreams: the pregrad launchpad, AI review, the
postgrad exchange, resolution, and deployment. A July 2026 audit of the
codebase found the pregrad loop working end to end on the local devchain, with
the remaining work concentrated in a few well-bounded verticals. Progress
toward the Arc Testnet launch needs a durable, reviewable home that survives
individual sessions and contributors.

## Decision

Track each vertical in its own repository-level ADR containing a progress
checklist. Checklists are updated in the same PR as the work they describe.
An ADR's vertical is complete when every box is checked and its exit criteria
hold.

Two scoping rules apply across all vertical ADRs:

- Code functionality first. Deploying a service or contract is never part of
  that vertical's work; all deployment work belongs to ADR 0015.
- Arc Testnet is the first public target. A security audit is out of scope
  until a mainnet plan exists.

### Vertical ADRs

| ADR | Vertical |
| --- | --- |
| [0008](0008-protocol-functionality-completion.md) | Protocol functionality completion |
| [0009](0009-server-api-hardening.md) | Server API hardening |
| [0010](0010-indexer-maturity.md) | Indexer maturity |
| [0011](0011-ai-review-service-hardening.md) | AI review service hardening |
| [0012](0012-ai-assisted-resolution.md) | AI-assisted resolution |
| [0013](0013-app-feature-completion.md) | App feature completion |
| [0014](0014-full-lifecycle-e2e-testing.md) | Full-lifecycle E2E testing |
| [0015](0015-deployment-and-infrastructure.md) | Deployment and infrastructure |

### Milestones

Milestones order the vertical work. Each milestone draws checklist items from
several ADRs; the ADRs remain the source of truth for item status.

1. **M1 — Launchpad code-complete.** The pregrad loop has no manual gaps:
   productionized clearing keeper (0008), graduation UX fully wired (0013),
   unhappy-path contract coverage (0008).
2. **M2 — The exchange half.** Postgrad markets become a product: venue
   handoff verified (0008), postgrad event indexing (0010), postgrad API
   surface (0009), postgrad trading UI (0013).
3. **M3 — Resolution.** AI-assisted resolution service (0012) and redemption
   UX (0013).
4. **M4 — Hardening and proof.** Service auth and security (0009, 0011),
   full-lifecycle happy and unhappy path E2E suites (0014).
5. **M5 — Deployment (final).** All of ADR 0015. Deploying the protocol to
   Arc Testnet is the final step of the final milestone.

## Consequences

Positive:

- Progress is visible in-repo and reviewable in PRs, not trapped in chat
  transcripts or external trackers.
- Scope boundaries (functionality vs. deployment) are written down once and
  referenced everywhere.

Tradeoffs:

- Checklists in ADRs drift if PRs forget to update them; reviewers must treat
  a stale checklist as a review defect.
- These ADRs record plans as well as decisions, which stretches the classic
  ADR form. We accept this for the tracking value.
