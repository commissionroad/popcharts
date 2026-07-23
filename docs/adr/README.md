# Repository Architecture Decision Records

This directory records repository-level decisions that do not belong entirely
to the frontend app or the Solidity protocol.

## Index

| ADR | Status | Decision |
| --- | --- | --- |
| [0006](0006-server-runtime-and-indexer.md) | Accepted | Use Bun and Elysia for the server and indexer package. |
| [0007](0007-track-verticals-with-progress-adrs.md) | Accepted | Track product verticals with progress ADRs and milestones M1–M5. |
| [0008](0008-protocol-functionality-completion.md) | Accepted | Complete protocol functionality (clearing keeper, resolution hooks, postgrad handoff) before any deployment. |
| [0009](0009-server-api-hardening.md) | Accepted | Keep dev/admin endpoints out of production, add rate limits and a real graduation trigger, and grow the API's lifecycle surface (search, portfolio, postgrad). Operator actions never go through the API. |
| [0010](0010-indexer-maturity.md) | Accepted | Bring the indexer to testnet grade (reorgs, leasing, RPC failover) and index the postgrad lifecycle. |
| [0011](0011-ai-review-service-hardening.md) | Accepted | Harden AI review for unattended operation (auth, safe evidence fetching, validation, metrics). |
| [0012](0012-ai-assisted-resolution.md) | Accepted | Build AI-assisted resolution as a sibling of AI review, with abstention and a local (not API) operator override. |
| [0013](0013-app-feature-completion.md) | Accepted | Complete the app across the full market lifecycle (Google sign-in, postgrad trading, unhappy paths). |
| [0014](0014-full-lifecycle-e2e-testing.md) | Accepted | Prove the full market lifespan, happy and unhappy, with an automated E2E suite. |
| [0015](0015-deployment-and-infrastructure.md) | Accepted | Own all CI and deployment work; deploy the protocol to Arc Testnet as the final step. |
| [0016](0016-monorepo-architecture-cleanup-program.md) | Accepted | Run a tracked, one-concern-per-PR monorepo cleanup program (Tracks A/B/D/E/F done; Track C open, human review required). |
| [0017](0017-test-observability-and-coverage-program.md) | Accepted | Make test health visible (PR coverage deltas, trends, badges, flake tracking — in-repo, no vendor) and enforce coverage where it protects value transfer. |
| [0018](0018-terminal-market-surface-and-redemption-ux.md) | Accepted | Give resolved and cancelled postgrad markets a first-class surface: keep the postgrad payload in the API, show the outcome, and ship wallet-signed redemption (redeem / redeemCancelled). |
| [0019](0019-ai-verdict-quality-program.md) | Accepted | Measure and harden AI review/resolution verdicts: offline eval harness, labeled failure-taxonomy dataset, deterministic pre-stages, reject-corroboration policy, and a CI consistency lane. |
| [0020](0020-concurrent-local-dev-stacks.md) | Accepted | Run concurrent local dev stacks as slot-addressed instances (slot 0 human, 1..n agents) with a home-dir registry, per-slot chain/DB/env/ports, identity-scoped chain reuse, and stack-aware create-market. |
| [0021](0021-live-market-updates.md) | Proposed | Make the app feel live: server-signalled, client-refetched updates over SSE, fed by a durable `change_feed` outbox written atomically with each indexed event. DB/REST stays the single source of truth; no message broker. |
| [0022](0022-review-first-market-creation.md) | Proposed | Invert market creation to review-first: questions live as off-chain editable Drafts, on-chain `createMarket` is gated by an authorizer signature (trusted-creator bypass) so markets are born Active, the creation fee is paid at publish (not submit), anti-spam is a prepaid refundable review bond in a separate native-USDC escrow, and creators get drafts/templates + a creator surface while the public board shows real markets only. |
| [0023](0023-protocol-security-audit-program.md) | Proposed | Run a tracked, one-item-per-pass security audit of the Solidity protocol against a fixed catalogue — Trail of Bits building-secure-contracts skills, root-cause classes from the 20 largest EVM exploits, and peer AMM/prediction-market audit categories — driven by a loop, producing a committed finding note per item. |
| [0024](0024-resolution-dispute-program.md) | Accepted | Land the on-chain resolution dispute window (protocol ADR 0013) across the stack: propose → 24h bonded public dispute → permissionless finalize, indexer/runner/keeper/UI slices, superseding ADR 0012's off-chain operator delay. |

Progress toward the Arc Testnet launch is tracked in the checklists inside
ADRs 0008–0015; ADR 0007 defines the process and milestone ordering. ADR 0016
(originally filed as a second "0007") is the standalone architecture-cleanup
program and is not part of the launch milestone chain; ADRs 0017 (test
observability and coverage), 0021 (live market updates), 0022 (review-first
market creation), 0023 (protocol security audit), and 0024 (resolution dispute window)
are likewise standalone tracked programs.

## Related ADRs

- Frontend app ADRs live in `../../app/docs/adr/`.
- Protocol ADRs live in `../../protocol/docs/adr/`.
