---
type: concept
title: Deployment and infrastructure
description: Vercel frontend + AWS CDK/ECS Fargate backend + Arc Testnet protocol deployment — all concentrated in milestone M5, nothing deployed yet.
sources:
  - docs/adr/0015-deployment-and-infrastructure.md
  - infra/README.md
  - docs/deployment/vercel.md
  - protocol/deployments/README.md
updated: 2026-07-07
---

# Deployment and infrastructure

**Nothing is deployed.** Deployment is concentrated in
[root ADR 0015](../summaries/root-adr-0015-deployment-and-infrastructure.md)
as milestone M5 and excluded from all functionality verticals by rule.
Sequencing: CI → CDK shared stage (VPC/RDS/ECR/Secrets) → ECS services →
monitoring → DNS → protocol to [Arc Testnet](../entities/arc-testnet.md)
last, via existing Ignition modules.

## Frontend (Vercel)

GitHub integration, project root `app`, previews on PRs, production on
`main`; no `VERCEL_*` secrets in GitHub — CI runs quality gates only.
Staleness: [the Vercel doc](../summaries/deployment-vercel.md) still
references the `sentilesdal/popcharts` remote (repo moved to
`commissionroad`) and an `app/pnpm-lock.yaml` that no longer exists
post-workspace-consolidation.

## Backend (AWS CDK, `infra/`)

Vercel app → HTTPS ALB → ECS Fargate API → RDS Proxy → RDS Postgres 16;
separate singleton [indexer](../entities/indexer.md) service on WSS RPC.
Two-phase deploy via `enableServices` flags; one-off Drizzle migration
Fargate task; secrets at `/popcharts/<stage>/<network>/rpc-wss-url`; API
autoscaling, indexer pinned to 1; prod = 2 NAT, Multi-AZ, deletion
protection. Planned additions: review service/runner,
[clearing keeper](../entities/clearing-keeper.md), resolution service as ECS
services with Secrets Manager keys. **Staleness**: `infra/README.md` still
targets Base/Base Sepolia (84532/8453), predating the Arc move.

## Protocol

`protocol/deployments/protocol.json` registry (currently no entries);
manifest promotion from `*.local.json`; Blockscout verification workflows —
see [protocol deployments](../summaries/protocol-deployments-readme.md).
Arc caps and single-EOA policy: [protocol ADR 0009](../summaries/protocol-adr-0009-complete-set-testnet-policy.md).
