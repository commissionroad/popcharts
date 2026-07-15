---
type: concept
title: Pop Charts overview
description: Top-level orientation — what Pop Charts is, how the mechanism works, how the workspaces fit together, and where the project stands (July 2026).
sources:
  - documents/whitepaper_v4.pdf
  - docs/architecture.md
  - docs/adr/0007-track-verticals-with-progress-adrs.md
updated: 2026-07-15
---

# Pop Charts overview

Pop Charts is a prediction-market protocol + product that solves the
cold-start problem: instead of requiring a funded market maker, markets
bootstrap through a **virtual LMSR** phase where buys are provisional priced
intents (receipts), then **graduate** via band-pass clearing — only price
bands with genuine two-sided demand convert into fully collateralized
[complete-set](concepts/complete-sets.md) outcome tokens; everything
unmatched refunds at exact cost. The mechanism is specified in
[whitepaper v4](concepts/mechanism-whitepaper.md) and its solvency identity
(`escrow = retained cost + locked collateral`) is the system's spine.

## The lifecycle in one line

create → [AI review](entities/ai-review-service.md) gate →
receipt bootstrap on the [PregradManager](entities/pregrad-manager.md) →
[band-pass graduation clearing](concepts/graduation-clearing.md) →
[adapter](entities/postgrad-adapter.md) handoff → ERC20
[complete-set trading](entities/postgrad-market.md) on a self-hosted
[Uniswap v4 venue](entities/postgrad-v4-venue.md) →
[resolution](concepts/ai-assisted-resolution.md) → redemption.
Full ladder: [market lifecycle](concepts/market-lifecycle.md).

## The workspaces

[Monorepo](concepts/monorepo-architecture.md) with an acyclic graph:
[protocol/](entities/protocol-workspace.md) (Solidity, Hardhat 3) →
[server/](entities/server-workspace.md) (Bun API +
[indexer](entities/indexer.md) + AI review) →
[app/](entities/app-workspace.md) (Next.js, styled from the read-only
[designkit/](entities/designkit.md)), with `infra/` (AWS CDK) and local
stacks orchestrated by `just` ([local dev](concepts/local-dev-orchestration.md)).

## Where things stand (2026-07-15)

- **Working locally end to end**: pregrad loop (create → review → receipts →
  graduation clearing → claims) on the [devchain](entities/devchain.md);
  postgrad venue smoke flows; AI review runner cycle. The
  [clearing keeper](entities/clearing-keeper.md)'s real band-pass sweep has
  landed (the greedy dev placeholder is gone; still poll-based and gated to the
  local network), and [AI resolution](concepts/ai-assisted-resolution.md)
  (service + leased runner) is building out — its on-chain transition, config,
  and redemption UI have begun landing.
- **Deployed**: the frontend went live on Vercel 2026-07-14 —
  `popcharts-landing` on popcharts.xyz and the app on app.popcharts.xyz (custom
  domains attached; Namecheap nameserver delegation pending). The **backend
  (AWS CDK/ECS) and the protocol contracts (Arc Testnet) are still undeployed**
  — see [deployment and infrastructure](concepts/deployment-and-infrastructure.md).
- **Not built**: indexer reorg-hardening, resolver-key/operator flows end to
  end, and the backend/protocol deployment (milestone M5).
- The road to [Arc Testnet](entities/arc-testnet.md) launch is tracked in
  vertical progress ADRs 0008–0015 (milestones M1–M5) — see
  [the conventions summary](summaries/root-adr-index-conventions.md).
