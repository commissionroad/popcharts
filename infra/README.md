# Pop Charts AWS Infrastructure

This package defines the first AWS deployment shape for the Pop Charts API and
indexer. It uses AWS CDK with TypeScript and targets ECS Fargate, RDS
PostgreSQL, RDS Proxy, ECR, Secrets Manager, CloudWatch Logs, and an optional
public Application Load Balancer.

## Architecture

```txt
Vercel app
  -> HTTPS ALB
    -> ECS Fargate service: popcharts-api
      -> RDS Proxy
        -> RDS PostgreSQL

ECS Fargate service: popcharts-indexer
  -> Base/Base Sepolia RPC WebSocket
  -> RDS Proxy
    -> RDS PostgreSQL
```

The API and indexer use the same `server/Dockerfile` image. The ECS container
command selects either `/app/dist/api/index.js` or
`/app/dist/indexer/index.js`.

## Repo Assumptions

- `server/` is the deployable backend package.
- The server runtime is Bun and Elysia.
- The API exposes `/health` for ALB and container health checks.
- The indexer writes `/tmp/popcharts-indexer-healthy` while its watcher is
  live.
- The indexer should run as a singleton service for now. Event writes are
  idempotent, but multiple live watchers would duplicate RPC work and race the
  cursor update path.
- `DATABASE_URL` still works for local development. ECS injects
  `DATABASE_HOST`, `DATABASE_USER`, `DATABASE_PASSWORD`, `DATABASE_NAME`,
  `DATABASE_PORT`, and `DATABASE_SSL=true` from RDS/RDS Proxy resources.

## What The Stack Creates

- VPC with public and private subnets.
- ECS cluster.
- ECR repository for the server image.
- RDS PostgreSQL 16 database named `popcharts`.
- RDS Proxy for connection pooling and failover resilience.
- Secrets Manager secret for generated DB credentials.
- Secrets Manager secret placeholder for the network RPC WebSocket URL.
- CloudWatch log groups for API, indexer, and migration tasks.
- Fargate task definitions for API, indexer, and one-off Drizzle migrations.
- Optional API ALB, API ECS service with autoscaling, and singleton indexer ECS
  service when `enableServices=true`.

`enableServices` defaults to `false` so the first deploy can create the network,
database, secrets, and ECR repository before an image exists. After pushing the
first image and setting secrets, redeploy with `enableServices=true`.

## CDK Context

Defaults live in `cdk.json`.

```bash
pnpm --dir infra install
pnpm --dir infra cdk synth
```

Run `cdk bootstrap` once per AWS account/region if this account has not used
modern CDK deployments before.

Useful context values:

```bash
-c stage=staging
-c network=baseSepolia      # baseSepolia or base
-c enableServices=false     # create shared infra first
-c enableServices=true      # create ECS services and ALB
-c pregradManagerAddress=0x...
-c pregradManagerDeployBlock=123456
-c certificateArn=arn:aws:acm:...
-c domainName=api.example.com
```

Example first pass:

```bash
pnpm --dir infra cdk deploy \
  -c stage=staging \
  -c network=baseSepolia \
  -c enableServices=false
```

## First Deployment Flow

1. Deploy shared infrastructure with `enableServices=false`.
2. Put the real WSS RPC URL into the output `RpcWssSecretName` secret.
3. Build and push the first server image to the output `ServerRepositoryUri`.
4. Run the migration task.
5. Redeploy with `enableServices=true`.
6. Point Vercel at the ALB/domain:

```bash
POPCHARTS_INDEXER_API_URL=https://api.example.com
POPCHARTS_MARKETS_CHAIN_ID=84532 # or 8453 for Base
POPCHARTS_MARKET_DATA_SOURCE=api
```

Build and push image:

```bash
cd server
bun install --frozen-lockfile
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin \
    "$(echo "$SERVER_REPOSITORY_URI" | cut -d/ -f1)"
docker buildx build --platform linux/amd64 \
  --build-arg GIT_COMMIT_SHA="$(git rev-parse HEAD)" \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  -t "$SERVER_REPOSITORY_URI:latest" \
  --push .
```

Run migrations from inside the VPC with the output task definition, private
subnets, and service security group:

```bash
aws ecs run-task \
  --cluster "$CLUSTER_NAME" \
  --task-definition "$MIGRATION_TASK_DEFINITION_ARN" \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$PRIVATE_SUBNET_IDS],securityGroups=[$SERVICE_SECURITY_GROUP_ID],assignPublicIp=DISABLED}"
```

Then enable the services:

```bash
pnpm --dir infra cdk deploy \
  -c stage=staging \
  -c network=baseSepolia \
  -c enableServices=true \
  -c pregradManagerAddress=0x... \
  -c pregradManagerDeployBlock=123456
```

## Scaling

- API service: autoscaled by CPU, memory, and ALB request count per target.
- Indexer service: desired count `1`. Add a DB-backed lease or leader election
  before scaling it above one task.
- RDS Proxy is included so API task count increases do not map directly to a
  burst of database connections.
- Production uses two NAT gateways, API desired count `2`, max API count `10`,
  Multi-AZ RDS, longer backups, and database deletion protection.
- Non-production uses smaller defaults for cost control.

## Secrets

The database credentials secret is generated by RDS. ECS injects the `username`
and `password` JSON fields into containers as `DATABASE_USER` and
`DATABASE_PASSWORD`.

The RPC WSS secret is created as:

```txt
/popcharts/<stage>/<network>/rpc-wss-url
```

Replace its generated placeholder with the actual Base/Base Sepolia WSS URL
before enabling services. The indexer receives it as `RPC_WSS_URL`; server
network config derives HTTP from WSS when no explicit HTTP URL is present.

## Verification

After deployment:

```bash
curl https://api.example.com/health
curl https://api.example.com/version
curl "https://api.example.com/markets?chainId=84532"
aws logs tail /ecs/popcharts-staging-api --since 10m --format short
aws logs tail /ecs/popcharts-staging-indexer --since 10m --format short
```

Look for:

- API `/health` returning `{ "status": "ok" }`.
- `/version` showing the expected network.
- Indexer logs showing the expected chain ID and `Indexer is running and healthy`.
- No `DATABASE_PASSWORD is required`, `RPC_WSS_URL is required`, or
  `PREGRAD_MANAGER_ADDRESS is required` startup failures.

## Recommended Next Steps

- Add a GitHub Actions deploy workflow that builds `server/Dockerfile`, pushes
  to ECR, runs the migration task, then updates both ECS services.
- Add CloudWatch alarms for ALB 5xx, target health, ECS restarts, RDS CPU,
  RDS connections, free storage, and indexer cursor lag.
- Add Route 53 alias records once the API domain is selected.
- Add a DB-backed indexer lease before running more than one indexer task.
- Promote Base Sepolia first, then duplicate the context for Base production.

## Sources

- [AWS ECS service autoscaling](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-auto-scaling.html)
- [AWS ECS target tracking policies](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-autoscaling-targettracking.html)
- [AWS ECS Secrets Manager environment variables](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html)
- [AWS ECS with Application Load Balancer](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/alb.html)
- [Application Load Balancer target health checks](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/target-group-health-checks.html)
- [Amazon RDS for PostgreSQL](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_PostgreSQL.html)
- [Amazon RDS best practices](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_BestPractices.html)
- [Amazon RDS encryption](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Overview.Encryption.html)
- [Amazon RDS Proxy](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy.html)
- [Aurora Serverless v2 scaling model](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2.how-it-works.html)
- Pop Charts server ADR: `docs/adr/0006-server-runtime-and-indexer.md`
- Pop Charts Vercel deployment notes: `docs/deployment/vercel.md`
