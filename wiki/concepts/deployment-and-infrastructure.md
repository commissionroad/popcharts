---
type: concept
title: Deployment and infrastructure
description: Vercel frontend (live) + AWS CDK/ECS Fargate backend + Arc Testnet protocol deployment — backend and protocol still M5, frontend went live 2026-07-14.
sources:
  - docs/adr/0015-deployment-and-infrastructure.md
  - infra/README.md
  - docs/deployment/vercel.md
  - docs/deployment/go-live-dns.md
  - protocol/deployments/README.md
updated: 2026-07-14
---

# Deployment and infrastructure

**The frontend is deployed; backend and protocol are not.** Backend/protocol
deployment is concentrated in
[root ADR 0015](../summaries/root-adr-0015-deployment-and-infrastructure.md)
as milestone M5 and excluded from all functionality verticals by rule.
Sequencing: CI → CDK shared stage (VPC/RDS/ECR/Secrets) → ECS services →
monitoring → DNS → protocol to [Arc Testnet](../entities/arc-testnet.md)
last, via existing Ignition modules.

## Frontend (Vercel)

Live since 2026-07-14: `popcharts-landing` (static marketing site from
`landing/`) and `popcharts-app` (GitHub integration, project root `app`,
previews on PRs, production on `main`; no `VERCEL_*` secrets in GitHub — CI
runs quality gates only). The no-env app deploy serves fixture markets
behind a sample-data banner; real chain/indexer env arrives with M5. Custom
domains `popcharts.xyz` / `app.popcharts.xyz` are attached, pending the
registrar nameserver change — see the
[go-live DNS runbook](../summaries/deployment-go-live-dns.md).

## Backend (AWS CDK, `infra/`)

Vercel app → HTTPS ALB → ECS Fargate API → RDS Proxy → RDS Postgres 16;
separate singleton [indexer](../entities/indexer.md) service on WSS RPC.
Two-phase deploy via `enableServices` flags; one-off Drizzle migration
Fargate task; secrets at `/popcharts/<stage>/<network>/rpc-wss-url`; API
autoscaling, indexer pinned to 1; prod = 2 NAT, Multi-AZ, deletion
protection. Planned additions: review service/runner,
[clearing keeper](../entities/clearing-keeper.md), resolution service + runner
as ECS services with Secrets Manager keys — the **server signer keys only**
(review-manager, resolver, graduation-manager); there is no API operator-auth
credential, operator actions are local-only ([root ADR 0009](../summaries/root-adr-0009-server-api-hardening.md)). **Staleness**: `infra/README.md` still
targets Base/Base Sepolia (84532/8453), predating the Arc move.

## Protocol

`protocol/deployments/protocol.json` registry (currently no entries);
manifest promotion from `*.local.json`; Blockscout verification workflows —
see [protocol deployments](../summaries/protocol-deployments-readme.md).
Arc caps and single-EOA policy: [protocol ADR 0009](../summaries/protocol-adr-0009-complete-set-testnet-policy.md).
