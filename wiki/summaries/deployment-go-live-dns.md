---
type: summary
title: Go-live DNS runbook (docs/deployment/go-live-dns.md)
description: Runbook for putting the landing page on popcharts.xyz and the app on app.popcharts.xyz — hosting projects, custom domains, and Namecheap nameserver delegation.
sources:
  - docs/deployment/go-live-dns.md
updated: 2026-07-14
---

# Go-live DNS runbook

`docs/deployment/go-live-dns.md` records the go-live path for the public
domains and doubles as the state ledger for how far along it is.

## Hosting projects

- `popcharts-landing` — static marketing site from `landing/` (no build
  step), production at `popcharts-landing.vercel.app`. Redeploys upload the
  three files as-is.
- `popcharts-app` — the [app workspace](../entities/app-workspace.md) via
  the GitHub integration (root `app`, no env vars needed for a first
  deploy: wallet integration self-disables and market data falls back to
  fixtures, which the discovery page labels with a sample-data banner).
  See [Vercel deployment](deployment-vercel.md).

## Domains and DNS

- `popcharts.xyz` → `popcharts-landing`; `app.popcharts.xyz` →
  `popcharts-app`. Both attached via the dashboard (done as of
  2026-07-14); they report "Invalid Configuration" until DNS resolves.
- Registrar is Namecheap. Recommended option delegates nameservers to
  `ns1`/`ns2.vercel-dns.com` so records are host-managed; the alternative
  keeps Namecheap DNS with an apex A record and `app`/`www` CNAMEs.
- Hands-on time is minutes; nameserver propagation can take up to 48
  hours. HTTPS certificates issue automatically once DNS resolves.

## Verification

`https://popcharts.xyz` serves the landing page, `https://app.popcharts.xyz`
serves the markets page, and landing CTAs land on the app domain.
