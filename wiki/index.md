# Wiki index

Read this first when answering questions; open only the pages you need.
Start at [overview.md](overview.md) for orientation. Maintenance rules:
[CLAUDE.md](CLAUDE.md). History: [log.md](log.md).

## Concepts (synthesis)

- [Overview](overview.md) — what Pop Charts is, how the pieces fit, status as of 2026-07-07
- [Market lifecycle](concepts/market-lifecycle.md) — the status ladder in its three vocabularies and who drives each transition
- [Graduation clearing](concepts/graduation-clearing.md) — band-pass clearing math, the E = R + L identity, and the optimistic onchain protocol
- [Complete sets](concepts/complete-sets.md) — mint/merge/redeem economics, the solvency invariant, and the ERC20-vs-CTF tokenization decision
- [Mechanism whitepaper](concepts/mechanism-whitepaper.md) — v4 as source of truth, and which repo vocabulary traces to superseded drafts
- [Creation-fee custody](concepts/creation-fee-custody.md) — the fee policy, the vault/policy split, and the whitepaper's explicit-fee constraint
- [AI-assisted resolution](concepts/ai-assisted-resolution.md) — the planned outcome pipeline (unbuilt) and its provenance caveats
- [Testing strategy](concepts/testing-strategy.md) — Solidity-first layers, whitepaper golden tests, smoke tiers, and the e2e launch gate
- [Deployment and infrastructure](concepts/deployment-and-infrastructure.md) — Vercel + AWS CDK + Arc, all M5, nothing deployed
- [Monorepo architecture](concepts/monorepo-architecture.md) — acyclic workspace contract and the intentional-duplication doctrine
- [Local dev orchestration](concepts/local-dev-orchestration.md) — the just/manifest-driven local stacks
- [Product honesty rule](concepts/product-honesty-rule.md) — the tested never-imply-a-guaranteed-fill copy contract

## Entities

- [PregradManager](entities/pregrad-manager.md) — singleton owning all pre-graduation market state
- [Postgrad market](entities/postgrad-market.md) — CompleteSetBinaryMarket, the ERC20 fixed-payout venue
- [Postgrad adapter](entities/postgrad-adapter.md) — the graduation handoff trust boundary
- [Postgrad v4 venue](entities/postgrad-v4-venue.md) — bounded hook, order manager, tick bounds, swap router
- [CreationFeeVault](entities/creation-fee-vault.md) — creation-fee custody base contract
- [Clearing keeper](entities/clearing-keeper.md) — planned band-pass clearing automation (not built)
- [protocol/ workspace](entities/protocol-workspace.md) — Hardhat 3 Solidity workspace and generated-metadata pipeline
- [app/ workspace](entities/app-workspace.md) — Next.js frontend, domain-first layout, Privy auth
- [server/ workspace](entities/server-workspace.md) — Bun/Elysia API, DB, and AI review processes
- [Indexer](entities/indexer.md) — viem chain ingestion and rebuildable projections
- [AI review service](entities/ai-review-service.md) — moderation/knowability service + leasing runner gating market entry
- [designkit/](entities/designkit.md) — read-only design-system source of truth
- [Devchain](entities/devchain.md) — local Hardhat proving ground for every exit criterion
- [Arc Testnet](entities/arc-testnet.md) — target network: chain 5042002, dual-decimal USDC, self-hosted v4

## Summaries — mechanism papers

- [Whitepaper v4](summaries/whitepaper-v4.md) — full mechanism spec: virtual LMSR, band-pass clearing, E = R + L, fill bounds, golden examples
- [Whitepaper history](summaries/whitepaper-history.md) — evolution v0.1 → v3 → v4 and what each draft kept or dropped

## Summaries — protocol ADRs (protocol/docs/adr/)

- [Constitution](summaries/protocol-constitution.md) — guiding principles: whitepaper truth, accounting identity, test-first bar
- [Context/glossary](summaries/protocol-context.md) — the protocol vocabulary: receipts, path bands, matched liquidity, status ladder
- [Protocol README](summaries/protocol-readme.md) — workspace orientation, commands, PregradManager as entry point
- [ADR 0001](summaries/protocol-adr-0001-hardhat-3-viem-pnpm.md) — Hardhat 3 + viem + pnpm stack
- [ADR 0002](summaries/protocol-adr-0002-whitepaper-v4-mechanism-source.md) — whitepaper v4 as mechanism source of truth
- [ADR 0003](summaries/protocol-adr-0003-v1-receipts-locked-non-transferable.md) — v1 receipts locked and non-transferable
- [ADR 0004](summaries/protocol-adr-0004-solidity-0-8-28.md) — Solidity pinned to 0.8.28
- [ADR 0005](summaries/protocol-adr-0005-singleton-pregrad-manager.md) — singleton PregradManager over factory-per-market
- [ADR 0006](summaries/protocol-adr-0006-optimistic-offchain-graduation-clearing.md) — optimistic offchain clearing with Merkle root + challenge window
- [ADR 0007](summaries/protocol-adr-0007-ctf-style-postgrad-handoff.md) — handoff to CTF-style postgrad via IPostgradAdapter
- [ADR 0008](summaries/protocol-adr-0008-complete-set-erc20-arc-testnet.md) — ERC20 complete sets on Arc Testnet (bounded deviation from 0007)
- [ADR 0009](summaries/protocol-adr-0009-complete-set-testnet-policy.md) — proposed testnet policy: caps, roles, display, audit gates
- [ADR 0010](summaries/protocol-adr-0010-disable-the-clearing-challenge-window-by-default.md) — Accepted — the clearing challenge window becomes owner-configurable `clearingChallengePeriod`, default 0, capped at 7 days; re-enable (~5 minutes) only when third-party proposers and a dispute mechanism exist

## Summaries — protocol design docs (protocol/docs/)

- [Code guidelines](summaries/protocol-code-guidelines.md) — Solidity conventions and hard pre-graduation invariants
- [Testing](summaries/protocol-testing.md) — two-layer test approach and whitepaper golden tests
- [Complete-set postgrad plan](summaries/protocol-complete-set-postgrad-plan.md) — first-pass research choosing ERC20 sets (superseded in detail)
- [v4 hook/order-manager plan](summaries/protocol-complete-set-v4-hook-order-manager-plan.md) — implementation blueprint for the bounded v4 venue (landed)
- [Postgrad contract metadata](summaries/protocol-postgrad-contract-metadata.md) — how server/indexer/UI discover the venue: manifests vs events
- [Deployments README](summaries/protocol-deployments-readme.md) — protocol.json registry, manifest promotion, Blockscout verification

## Summaries — program/vertical ADRs (docs/adr/)

- [ADR conventions](summaries/root-adr-index-conventions.md) — the progress-ADR process and milestones M1–M5
- [ADR 0006](summaries/root-adr-0006-server-runtime-and-indexer.md) — Bun + Elysia + Drizzle server, viem indexer
- [ADR 0007 (cleanup)](summaries/root-adr-0007-monorepo-architecture-cleanup-program.md) — ~30-PR cleanup program; Track C still open (duplicate number!)
- [ADR 0007 (verticals)](summaries/root-adr-0007-track-verticals-with-progress-adrs.md) — checklist-bearing vertical ADRs 0008–0015 (duplicate number!)
- [ADR 0008](summaries/root-adr-0008-protocol-functionality-completion.md) — finish protocol: keeper, resolution hooks, unhappy paths (all open)
- [ADR 0009](summaries/root-adr-0009-server-api-hardening.md) — operator auth, rate limits, lifecycle API surface (all open)
- [ADR 0010](summaries/root-adr-0010-indexer-maturity.md) — reorgs, confirmation depth, failover, postgrad indexing (all open)
- [ADR 0011](summaries/root-adr-0011-ai-review-service-hardening.md) — harden AI review for unattended operation (all open)
- [ADR 0012](summaries/root-adr-0012-ai-assisted-resolution.md) — build resolution as a sibling of review (all open)
- [ADR 0013](summaries/root-adr-0013-app-feature-completion.md) — app across the full lifecycle incl. postgrad UX (all open)
- [ADR 0014](summaries/root-adr-0014-full-lifecycle-e2e-testing.md) — the every-terminal-state e2e suite; acceptance gate for M1–M4 (all open)
- [ADR 0015](summaries/root-adr-0015-deployment-and-infrastructure.md) — CI + AWS + Arc deployment as M5 (all open)

## Summaries — root docs

- [Root README](summaries/root-readme.md) — quickstart, local stacks, just menu
- [Architecture](summaries/architecture.md) — workspace map, dependency contract, intentional duplications
- [Devchain](summaries/devchain.md) — local e2e flow, postgrad local deploy, Arc config
- [AI review runner design](summaries/ai-review-runner-design.md) — the durable-job runner bridging projections to the review service
- [AI review next phase](summaries/ai-review-next-phase.md) — provider triad, service split rationale, AWS shape, injection defenses
- [Vercel deployment](summaries/deployment-vercel.md) — frontend deploy pipeline (has stale org/lockfile references)
- [Portfolio data design](summaries/portfolio-data-design.md) — DB-backed Portfolio spec: Transfer-event balance indexing, one aggregate owner endpoint, receipt→settlement join, current-value-not-PnL v1

## Summaries — app, server, infra, designkit

- [App context/glossary](summaries/app-context.md) — the frontend's product-language glossary
- [App README](summaries/app-readme.md) — stack, Privy config, data-source modes, structure
- [App ADR index](summaries/app-adr-readme.md) — the five app ADRs and when to add one
- [App ADR 0001](summaries/app-adr-0001-frontend-framework.md) — Next.js App Router
- [App ADR 0002](summaries/app-adr-0002-styling-and-design-system.md) — Tailwind v4 on designkit semantic tokens
- [App ADR 0003](summaries/app-adr-0003-domain-first-module-layout.md) — domain-first module boundaries
- [App ADR 0004](summaries/app-adr-0004-testing-and-ci-gates.md) — layered testing and required CI gates
- [App ADR 0005](summaries/app-adr-0005-code-quality-and-dependency-policy.md) — strict TS quality stack and ADR-gated dependencies
- [Component inventory](summaries/app-component-inventory.md) — the twelve shared UI components and designkit mappings
- [App resolution README](summaries/app-domain-resolution-readme.md) — resolution is an intentional placeholder
- [App integrations README](summaries/app-integrations-readme.md) — adapters-only boundary rule
- [Server README](summaries/server-readme.md) — API + indexer + AI review setup, endpoints, smoke flows
- [Infra README](summaries/infra-readme.md) — AWS CDK shape (stale: still targets Base, pre-Arc)
- [Designkit README](summaries/designkit-readme.md) — brand voice, vocabulary table, visual foundations
