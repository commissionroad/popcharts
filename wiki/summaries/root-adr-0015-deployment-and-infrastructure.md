---
type: summary
title: Repo ADR 0015 — Deployment and infrastructure
description: Vertical ADR owning all CI and deployment — per-package CI, AWS CDK stack, ECS services, monitoring, and the Arc Testnet protocol deployment as the final step of milestone M5; all thirteen items open.
sources:
  - docs/adr/0015-deployment-and-infrastructure.md
updated: 2026-07-07
---

# Repo ADR 0015: Deployment And Infrastructure

**Status: Accepted.** Dated 2026-07-06. Vertical checklist per ADR 0007
([summary](root-adr-0007-track-verticals-with-progress-adrs.md)); this is the
final milestone (M5).

## Context

Nothing is deployed anywhere: `protocol/deployments/protocol.json` is empty
for every network, the AWS CDK stack in `infra/` (VPC, RDS, ECS Fargate,
Secrets Manager, ALB) has never been run, and CI covers only the app package.
The app deploys to Vercel previews/production via the GitHub integration but
points at no live backend. Per ADR 0007, deployment is deliberately excluded
from every functionality vertical and concentrated here. Deploying the
protocol to Arc Testnet is the last step: services are stood up and verified
first, then contracts go live and the stack flips on against them.

## Decision

Own all CI and deployment work in this vertical: CI for every package,
containerization and cloud deployment of server-side services, operational
monitoring, and — last — the protocol deployment to Arc Testnet.

## Progress (all items unchecked as of 2026-07-07)

Continuous integration (unblocks early, cheap to do first):

- [ ] Server CI workflow: typecheck, OpenAPI check, tests against a Postgres
  service container.
- [ ] Protocol CI workflow: format, lint, typecheck, Solidity + node tests.
- [ ] Scheduled/full-suite job running the lifecycle E2E (ADR 0014) with the
  heuristic provider.

Cloud stack (Arc Testnet staging):

- [ ] First real `cdk deploy` of the shared stage (`enableServices=false`):
  VPC, RDS, ECR, Secrets Manager.
- [ ] Image build/publish workflow (server image → ECR) and a migration
  run-task step.
- [ ] ECS services for API, indexer, AI review service + runner, clearing
  keeper, and resolution service + runner (`enableServices=true`).
- [ ] Secrets populated: RPC HTTP/WSS URLs, `ANTHROPIC_API_KEY`,
  review-manager and resolver keys, operator auth credentials.
- [ ] Monitoring: CloudWatch dashboards/alarms on ALB 5xx, ECS restarts, RDS
  health, indexer cursor lag, review/resolution queue depth (metrics from
  ADRs 0010/0011/0012).
- [ ] DNS/certificate for the API; Vercel production env pointed at it.
- [ ] Operator runbook: deploy, roll back, rotate secrets, unstick jobs,
  recover the indexer.

Protocol deployment (final step):

- [ ] Resolve Arc-side prerequisites: collateral token choice (real Arc USDC
  vs. mock) and the v4 PoolManager question (ADR 0008).
- [ ] Deploy the protocol to Arc Testnet via the existing Ignition modules;
  record addresses in `protocol/deployments/protocol.json`; export contract
  metadata for server and app.
- [ ] Point staging services at the live contracts; run the lifecycle smoke
  against Arc Testnet end to end.

## Exit criteria

A user on the public internet completes the ADR 0013 exit-criteria journey
against Arc Testnet, with every service running in AWS, deploys reproducible
from CI, and alarms in place for known failure modes.

## Consequences

Services-before-protocol sequencing means staging services idle against an
empty network config until the final step — accepted, to shake out
deploy/monitoring kinks before contracts are live. Everything assumes Arc
Testnet economics (no audit, mock-or-test collateral); a mainnet milestone
gets its own ADR (audit, fraud proofs, reorg-grade guarantees, the
CTF-compatibility decision).

## Staleness note

The CI items may lag reality: the monorepo cleanup program's Progress Log
(2026-07-07) references an existing required "Server CI" (running
`openapi:check`) and an "App CI" with path filters, suggesting some CI
checkboxes here are stale-unticked. Verify against `.github/workflows/` when
updating this vertical.

## Related pages

- [../concepts/deployment-and-infrastructure.md](../concepts/deployment-and-infrastructure.md)
- [../concepts/testing-strategy.md](../concepts/testing-strategy.md)
- [../entities/protocol-workspace.md](../entities/protocol-workspace.md)
- [../entities/server-workspace.md](../entities/server-workspace.md)
- [../entities/app-workspace.md](../entities/app-workspace.md)
- [../entities/indexer.md](../entities/indexer.md)
- [../entities/ai-review-service.md](../entities/ai-review-service.md)
