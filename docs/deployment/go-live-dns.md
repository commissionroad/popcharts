# Go-Live: popcharts.xyz DNS and Domains

Runbook for putting the landing page on `popcharts.xyz` and the app on
`app.popcharts.xyz`. Written 2026-07-14, when the landing page first went
live; updated the same day after the dashboard steps were completed. State:

- **Live**: `popcharts-landing` hosting project (static site from
  `landing/`), production deployment at
  `https://popcharts-landing.vercel.app`; `popcharts-app` (Next.js from
  `app/` via the GitHub integration), production deployment at
  `https://popcharts-app.vercel.app`.
- **Attached, pending DNS**: `popcharts.xyz` → `popcharts-landing`,
  `app.popcharts.xyz` → `popcharts-app` (steps 1–2 below are done; they
  show "Invalid Configuration" until step 3 propagates).

The hands-on steps take a few minutes; nameserver changes can take up to
48 hours to propagate globally (usually far less). Cloud agent sessions
generally cannot perform them: the registrar (Namecheap) is outside the
sandbox network egress policy, and the hosting MCP toolset has no
domain-management or git-integration endpoints. A local session driving the
user's browser can.

## 1. App project (Vercel dashboard)

Follow `docs/deployment/vercel.md` — the repo is designed for the GitHub
integration (deploys on push to `main`, previews on PRs):

1. Vercel dashboard → Add New → Project → import
   `commissionroad/popcharts`.
2. Root directory: `app`. Framework: Next.js. Install/build commands are
   already committed in `app/vercel.json`.
3. No env vars are required for a first deploy: with no
   `NEXT_PUBLIC_PRIVY_APP_ID` the wallet integration disables itself, and
   the market data source defaults to mock fixtures (verified by a clean
   local `pnpm --dir app build` with an empty env). The discovery page
   labels fixture-backed markets with a sample-data banner, so the public
   deploy never implies live volume. Real chain/indexer env comes later
   with the backend (root ADR 0015, milestone M5).

## 2. Custom domains (Vercel dashboard)

- `popcharts-landing` project → Settings → Domains → add `popcharts.xyz`
  (and optionally `www.popcharts.xyz`, redirecting to the apex).
- App project → Settings → Domains → add `app.popcharts.xyz`.

## 3. DNS (Namecheap)

Two options; A is less ongoing work.

**Option A — delegate DNS to the host (recommended).** Namecheap →
Domain List → `popcharts.xyz` → Nameservers → Custom DNS →
`ns1.vercel-dns.com`, `ns2.vercel-dns.com`. Once the domains are attached
to the projects (step 2), all records are managed automatically.

**Option B — keep Namecheap DNS.** Advanced DNS for `popcharts.xyz`:
remove the default parking records, then add the records the domain screens
from step 2 display. As of this writing the standard values are:

| Type  | Host | Value                  |
| ----- | ---- | ---------------------- |
| A     | `@`  | `76.76.21.21`          |
| CNAME | `app`| `cname.vercel-dns.com` |
| CNAME | `www`| `cname.vercel-dns.com` |

Prefer the exact values shown in the dashboard if they differ — the
provider has newer per-project values it may recommend instead.

## 4. Verify

- `https://popcharts.xyz` serves the landing page over HTTPS (certificates
  are issued automatically once DNS resolves; allow a few minutes).
- `https://app.popcharts.xyz` serves the app markets page.
- Landing-page CTAs ("Open app", "Pop a market", "See all") land on the app
  domain.
