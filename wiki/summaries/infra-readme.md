---
type: summary
title: Infra README
description: AWS CDK deployment shape for API + indexer — ECS Fargate, RDS Postgres + Proxy, Secrets Manager, optional ALB, two-phase enableServices deploy, singleton indexer
sources:
  - infra/README.md
updated: 2026-07-07
---

# Infra README

`infra/README.md` defines the **first AWS deployment shape** for the Pop
Charts API and indexer: AWS CDK in TypeScript targeting ECS Fargate, RDS
PostgreSQL 16 (+ RDS Proxy), ECR, Secrets Manager, CloudWatch Logs, and an
optional public ALB. The Vercel-hosted app calls the ALB-fronted API service;
the indexer service talks to a Base/Base Sepolia RPC WebSocket. Both services
run the same `server/Dockerfile` image, with the container command selecting
`/app/dist/api/index.js` or `/app/dist/indexer/index.js`. See
[deployment and infrastructure](../concepts/deployment-and-infrastructure.md).

## Repo assumptions

`server/` is the deployable backend (Bun + Elysia); the API exposes `/health`
for ALB/container checks; the indexer writes `/tmp/popcharts-indexer-healthy`
while its watcher is live; the **indexer must run as a singleton** for now —
event writes are idempotent, but multiple watchers would duplicate RPC work
and race the cursor update path. `DATABASE_URL` still works locally; ECS
injects `DATABASE_HOST/USER/PASSWORD/NAME/PORT` and `DATABASE_SSL=true`.

## Two-phase deployment

`enableServices` defaults to `false` so the first deploy creates network,
database, secrets, and ECR before any image exists. Flow:

1. Deploy shared infra (`-c enableServices=false`, `-c stage=…`,
   `-c network=baseSepolia|base`).
2. Put the real WSS RPC URL into the generated
   `/popcharts/<stage>/<network>/rpc-wss-url` secret (indexer receives it as
   `RPC_WSS_URL`; HTTP is derived from WSS when unset).
3. Build/push the server image to the ECR output URI (linux/amd64, with
   `GIT_COMMIT_SHA` and `BUILD_TIME` build args).
4. Run the one-off Drizzle migration Fargate task inside the VPC.
5. Redeploy with `enableServices=true` plus `pregradManagerAddress` and
   `pregradManagerDeployBlock` context ([PregradManager](../entities/pregrad-manager.md)).
6. Point Vercel at the ALB/domain: `POPCHARTS_INDEXER_API_URL`,
   `POPCHARTS_MARKETS_CHAIN_ID=84532` (or `8453` for Base),
   `POPCHARTS_MARKET_DATA_SOURCE=api`.

`enableApiService` / `enableIndexerService` allow bringing the API live before
the protocol address and RPC secret are ready.

## Scaling and secrets

API autoscales on CPU, memory, and ALB request count; indexer desired count is
`1` (add a DB-backed lease or leader election before scaling above one task).
RDS Proxy decouples API task count from DB connections. Production: two NAT
gateways, API desired 2 / max 10, Multi-AZ RDS, longer backups, deletion
protection; non-production uses smaller defaults. DB credentials are an
RDS-generated secret injected as `DATABASE_USER`/`DATABASE_PASSWORD`.

## Verification and next steps

Post-deploy checks: `/health` returns `{"status":"ok"}`, `/version` shows the
expected network, `GET /markets?chainId=…` works, indexer logs show the
expected chain ID and `Indexer is running and healthy`, and no missing-env
startup failures. Recommended next steps: GitHub Actions deploy workflow,
CloudWatch alarms (ALB 5xx, target health, ECS restarts, RDS CPU/connections/
storage, indexer cursor lag), Route 53 aliases, a DB-backed indexer lease,
and promoting Base Sepolia before duplicating context for Base production.

Note: this README targets **Base / Base Sepolia** (chain ids 8453 / 84532),
while `app/README.md` describes an Arc Testnet-first wallet list and an
example chain id `5042002`, and `server/README.md` uses
`ARC_TESTNET_PREGRAD_MANAGER_ADDRESS` — the infra doc's network naming looks
older than the current Arc-oriented configuration.

## Related pages

- [Server workspace](../entities/server-workspace.md)
- [Indexer](../entities/indexer.md)
- [Summary: server readme](server-readme.md)
