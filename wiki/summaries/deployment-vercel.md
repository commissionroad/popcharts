---
type: summary
title: Vercel Deployments (docs/deployment/vercel.md)
description: How the frontend deploys from app/ via Vercel's GitHub integration — preview/production branch mapping, project settings, and pre-land verification checks.
sources:
  - docs/deployment/vercel.md
updated: 2026-07-07
---

# Vercel Deployments

`docs/deployment/vercel.md` covers frontend deployment: Pop Charts deploys the
[app workspace](../entities/app-workspace.md) from `app/` through Vercel's
GitHub integration.

## What runs

- Pull requests to `main` → Vercel Preview deployments; pushes to `main` →
  Production deployments.
- The Vercel project root directory is `app`; the production branch is
  `main`.
- GitHub Actions still runs app quality gates
  (`.github/workflows/app-ci.yml`), but deployment is owned by Vercel — no
  `VERCEL_TOKEN`, `VERCEL_ORG_ID`, or `VERCEL_PROJECT_ID` GitHub secrets are
  required.

## Project settings

The Vercel project is linked to `sentilesdal/popcharts`. The local link lives
in `app/.vercel/project.json`, which stays uncommitted (`app/.gitignore`
excludes `.vercel/`). The doc gives the CLI recipe to recreate the setup
(`vercel link --scope sentilesdals-projects --project popcharts`,
`vercel git connect`) and a `vercel api` PATCH that pins project settings:
`rootDirectory: "app"`, `framework: "nextjs"`,
`installCommand: "pnpm install --frozen-lockfile"`,
`buildCommand: "pnpm build"`.

## Verification

Before landing deployment changes, run the same app checks locally:
`pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`,
`pnpm build`, `pnpm test:e2e:smoke`. See
[testing strategy](../concepts/testing-strategy.md).

## Related pages

- [Deployment and infrastructure](../concepts/deployment-and-infrastructure.md)
  — frontend on Vercel vs. API/indexer on AWS.
- [Devchain summary](devchain.md) — Preview-scoped devchain env rules
  (`POPCHARTS_DEVCHAIN_PRIVATE_KEY` Preview-only, never
  `POPCHARTS_DEVCHAIN_ENABLED=true` in Production).

## Staleness note

The doc links the Vercel project to `sentilesdal/popcharts`, but the repo has
since moved to the `commissionroad` GitHub org; the linked-repo reference may
be stale.
