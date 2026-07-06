# ADR 0015: Deployment And Infrastructure

Status: Accepted

Date: 2026-07-06

## Context

Nothing is deployed anywhere: `protocol/deployments/protocol.json` is empty
for every network, the AWS CDK stack in `infra/` (VPC, RDS, ECS Fargate,
Secrets Manager, ALB) has never been run, and CI covers only the app package.
The app itself deploys to Vercel previews/production via the GitHub
integration, but points at no live backend.

Per ADR 0007, deployment is deliberately excluded from every functionality
vertical and concentrated here, as the final milestone (M5). Deploying the
protocol to Arc Testnet is the last step: services are stood up and verified
first, then contracts go live and the stack flips on against them.

## Decision

Own all CI and deployment work in this vertical: continuous integration for
every package, containerization and cloud deployment of the server-side
services, operational monitoring, and — last — the protocol deployment to Arc
Testnet.

## Progress

Continuous integration (unblocks early, cheap to do first):

- [ ] Server CI workflow: typecheck, OpenAPI check, tests against a Postgres
      service container.
- [ ] Protocol CI workflow: format, lint, typecheck, Solidity + node tests.
- [ ] Scheduled/full-suite job running the lifecycle E2E (ADR 0014) with
      the heuristic provider.

Cloud stack (Arc Testnet staging):

- [ ] First real `cdk deploy` of the shared stage (`enableServices=false`):
      VPC, RDS, ECR, Secrets Manager.
- [ ] Image build/publish workflow (server image → ECR) and a migration
      run-task step.
- [ ] ECS services for API, indexer, AI review service + runner, clearing
      keeper, and resolution service + runner (`enableServices=true`).
- [ ] Secrets populated: RPC HTTP/WSS URLs, `ANTHROPIC_API_KEY`,
      review-manager and resolver keys, operator auth credentials.
- [ ] Monitoring: CloudWatch dashboards and alarms on ALB 5xx, ECS restarts,
      RDS health, indexer cursor lag, and review/resolution queue depth
      (metrics from ADRs 0010/0011/0012).
- [ ] DNS/certificate for the API; Vercel production env pointed at it.
- [ ] Operator runbook: deploy, roll back, rotate secrets, unstick jobs,
      recover the indexer.

Protocol deployment (final step):

- [ ] Resolve Arc-side prerequisites: collateral token choice (real Arc
      USDC vs. mock) and the v4 PoolManager question (ADR 0008).
- [ ] Deploy the protocol to Arc Testnet via the existing Ignition modules;
      record addresses in `protocol/deployments/protocol.json` and export
      contract metadata for server and app.
- [ ] Point staging services at the live contracts; run the lifecycle
      smoke against Arc Testnet end to end.

## Exit Criteria

A user on the public internet can complete the ADR 0013 exit-criteria journey
against Arc Testnet, with every service running in AWS, deploys reproducible
from CI, and alarms in place for the failure modes we know about.

## Consequences

- Sequencing services-before-protocol means staging services idle against an
  empty network config until the final step; acceptable, since it lets
  deploy/monitoring kinks shake out before contracts are live.
- Everything here assumes Arc Testnet economics (no audit, mock-or-test
  collateral). A mainnet milestone gets its own ADR: audit, fraud proofs,
  reorg-grade guarantees, and the CTF-compatibility decision.
