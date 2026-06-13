# Vercel Deployments

Pop Charts deploys the frontend app from `app/` through GitHub Actions using
Vercel prebuilt deployments.

## What Runs

- Pull requests to `main` that touch `app/**` create a Vercel Preview
  deployment and update one PR comment with the latest URL.
- Pushes to `main` that touch `app/**` create a Vercel Production deployment.
- The workflow runs `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, and
  `pnpm test:e2e:smoke` before deploying.
- Preview deployments run only for same-repository PRs. GitHub does not expose
  repository secrets to untrusted fork PRs.

The workflow owns deployment automation. `app/vercel.json` disables Vercel's
dashboard Git auto-deploys to avoid duplicate builds for the same commit.

## Required GitHub Secrets

Add these repository secrets before expecting deployments to pass:

```txt
VERCEL_TOKEN
VERCEL_ORG_ID
VERCEL_PROJECT_ID
```

The Vercel project should use `app` as its project root. Keep `.vercel/`
uncommitted; `app/.gitignore` already excludes it.

## Finding The IDs

From a local Vercel login:

```bash
cd app
vercel link
cat .vercel/project.json
```

Use `orgId` for `VERCEL_ORG_ID` and `projectId` for
`VERCEL_PROJECT_ID`. Create a Vercel token in the dashboard and store it as
`VERCEL_TOKEN`.

Using GitHub CLI:

```bash
gh secret set VERCEL_TOKEN --repo sentilesdal/popcharts
gh secret set VERCEL_ORG_ID --repo sentilesdal/popcharts
gh secret set VERCEL_PROJECT_ID --repo sentilesdal/popcharts
```
