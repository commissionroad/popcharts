---
type: summary
title: App Integrations README
description: Boundary rule for app/src/integrations — adapters for wallet/contracts/indexer/analytics keep domain logic out and parse external data into typed shapes
sources:
  - app/src/integrations/README.md
updated: 2026-07-07
---

# App Integrations README

`app/src/integrations/README.md` is a three-line boundary statement for the
integrations directory. It holds **adapters** for wallet, contracts, indexers,
analytics, and future external services, with two rules:

1. Keep domain logic out of adapters.
2. Parse external data into typed app shapes **before** it enters features.

This is the enforcement point for the anti-corruption layer described in
[app ADR 0003](app-adr-0003-domain-first-module-layout.md) (which also calls
for `zod`-style schema boundaries for untrusted external data) and echoed in
[app ADR 0004](app-adr-0004-testing-and-ci-gates.md)'s rule to mock
integrations at their boundaries rather than mocking the domain. The wallet
adapter isolation is what lets `app/README.md` promise that Solana support
could be added inside `src/integrations/wallet/` without changing domain
modules ([summary](app-readme.md)); the indexer adapter is the app-side client
of the [server workspace](../entities/server-workspace.md) /
[indexer](../entities/indexer.md) read API.

## Related pages

- [App workspace](../entities/app-workspace.md)
