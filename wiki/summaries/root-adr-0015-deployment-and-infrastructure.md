---
type: summary
title: Repo ADR 0015 — Deployment and infrastructure
description: Vertical ADR owning all CI and deployment — per-package CI, AWS CDK stack, ECS services, monitoring, and the Arc Testnet protocol deployment as the final step of milestone M5; 1 of 13 done as of the 2026-07-09 reconcile (Protocol CI), secrets corrected to signer-keys-only (no API operator-auth).
sources:
  - docs/adr/0015-deployment-and-infrastructure.md
updated: 2026-07-15
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

> Reality note (2026-07-15): two of the Context premises above have moved since
> the ADR was written. **CI is no longer app-only** — app, server, protocol, and
> infra each gate their own paths (four required status checks on `main`; the
> infra gate landed with ADR 0017 Track E). And the **frontend is now live** on
> custom domains: `popcharts-landing` on popcharts.xyz and the app on
> app.popcharts.xyz since 2026-07-14 (still pointing at no live backend). The
> AWS CDK stack and the Arc protocol deployment remain the open M5 work. See
> [deployment and infrastructure](../concepts/deployment-and-infrastructure.md).

## Decision

Own all CI and deployment work in this vertical: CI for every package,
containerization and cloud deployment of server-side services, operational
monitoring, and — last — the protocol deployment to Arc Testnet.

## Progress (1 of 13 done as of the 2026-07-09 checklist reconcile)

Continuous integration (unblocks early, cheap to do first):

- [ ] Server CI workflow: typecheck, OpenAPI check, tests against a Postgres
  service container. **Partially real, and the open box is honest** (verified
  2026-07-14, closing an earlier lint question): `.github/workflows/server-ci.yml`
  exists and runs format-check, lint, typecheck, `openapi:check`, and
  `test:coverage` behind a paths filter — but it has **no Postgres service
  container**, which is the part of this item that is actually missing.
- [x] Protocol CI workflow: format, lint, typecheck, Solidity + node tests.
- [ ] Scheduled/full-suite job running the lifecycle E2E (ADR 0014) with the
  heuristic provider.

Cloud stack (Arc Testnet staging):

- [ ] First real `cdk deploy` of the shared stage (`enableServices=false`):
  VPC, RDS, ECR, Secrets Manager.
- [ ] Image build/publish workflow (server image → ECR) and a migration
  run-task step.
- [ ] ECS services for API, indexer, AI review service + runner, clearing
  keeper, and resolution service + runner (`enableServices=true`).
- [ ] Secrets populated: RPC HTTP/WSS URLs, `ANTHROPIC_API_KEY`, and the
  server signer keys (review-manager, resolver, graduation-manager). No API
  operator-auth credentials — operator actions are local-only (ADR 0009).
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

## Staleness note — resolved 2026-07-14

An earlier lint suspected the Server CI checkbox was **stale-unticked**, because
the cleanup program's Progress Log references a required "Server CI" running
`openapi:check`. Checked against `.github/workflows/`: all three workflows exist
(`app-ci.yml`, `protocol-ci.yml`, `server-ci.yml`), and Server CI does run
format-check, lint, typecheck, `openapi:check`, and `test:coverage` behind a
paths filter. But it has **no Postgres service container**, and "tests against a
Postgres service container" is what this item asks for — so the unticked box is
correct, not stale. The gap is narrower than "no Server CI": it is the Postgres
service, and the ADR item could be split to say so.

## Related pages

- [../concepts/deployment-and-infrastructure.md](../concepts/deployment-and-infrastructure.md)
- [../concepts/testing-strategy.md](../concepts/testing-strategy.md)
- [../entities/protocol-workspace.md](../entities/protocol-workspace.md)
- [../entities/server-workspace.md](../entities/server-workspace.md)
- [../entities/app-workspace.md](../entities/app-workspace.md)
- [../entities/indexer.md](../entities/indexer.md)
- [../entities/ai-review-service.md](../entities/ai-review-service.md)
