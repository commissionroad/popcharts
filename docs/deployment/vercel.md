# Vercel Deployments

Pop Charts deploys the frontend app from `app/` through Vercel's GitHub
integration.

## What Runs

- Pull requests to `main` create Vercel Preview deployments.
- Pushes to `main` create Vercel Production deployments.
- The Vercel project root directory is `app`.
- The production branch is `main`.

GitHub Actions still runs app quality gates in `.github/workflows/app-ci.yml`.
Deployment itself is owned by Vercel, so no `VERCEL_TOKEN`,
`VERCEL_ORG_ID`, or `VERCEL_PROJECT_ID` GitHub secrets are required.

## Project Settings

The Vercel project is linked to:

```txt
sentilesdal/popcharts
```

The local project link lives in `app/.vercel/project.json`. Keep `.vercel/`
uncommitted; `app/.gitignore` already excludes it.

To recreate the Vercel setup from a logged-in local CLI:

```bash
cd app
vercel link --yes --scope sentilesdals-projects --project popcharts
vercel git connect git@github.com:sentilesdal/popcharts.git --scope sentilesdals-projects
```

Set or confirm the project root directory:

```bash
ORG_ID="$(jq -r '.orgId' .vercel/project.json)"
PROJECT_ID="$(jq -r '.projectId' .vercel/project.json)"
body="$(mktemp)"
cat >"$body" <<'JSON'
{
  "rootDirectory": "app",
  "framework": "nextjs",
  "installCommand": "pnpm install --frozen-lockfile",
  "buildCommand": "pnpm build"
}
JSON
vercel api "/v9/projects/${PROJECT_ID}?teamId=${ORG_ID}" -X PATCH --input "$body"
rm "$body"
```

## Verification

Run the same app checks locally before landing deployment changes:

```txt
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm build
pnpm test:e2e:smoke
```
