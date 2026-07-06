# Repository Architecture Decision Records

This directory records repository-level decisions that do not belong entirely
to the frontend app or the Solidity protocol.

## Index

| ADR | Status | Decision |
| --- | --- | --- |
| [0006](0006-server-runtime-and-indexer.md) | Accepted | Use Bun and Elysia for the server and indexer package. |
| [0007](0007-track-verticals-with-progress-adrs.md) | Accepted | Track product verticals with progress ADRs and milestones M1–M5. |
| [0008](0008-protocol-functionality-completion.md) | Accepted | Complete protocol functionality (clearing keeper, resolution hooks, postgrad handoff) before any deployment. |
| [0009](0009-server-api-hardening.md) | Accepted | Harden the API (operator auth, rate limits) and grow its lifecycle surface (search, portfolio, postgrad). |
| [0010](0010-indexer-maturity.md) | Accepted | Bring the indexer to testnet grade (reorgs, leasing, RPC failover) and index the postgrad lifecycle. |
| [0011](0011-ai-review-service-hardening.md) | Accepted | Harden AI review for unattended operation (auth, safe evidence fetching, validation, metrics). |
| [0012](0012-ai-assisted-resolution.md) | Accepted | Build AI-assisted resolution as a sibling of AI review, with abstention and operator override. |
| [0013](0013-app-feature-completion.md) | Accepted | Complete the app across the full market lifecycle (Google sign-in, postgrad trading, unhappy paths). |
| [0014](0014-full-lifecycle-e2e-testing.md) | Accepted | Prove the full market lifespan, happy and unhappy, with an automated E2E suite. |
| [0015](0015-deployment-and-infrastructure.md) | Accepted | Own all CI and deployment work; deploy the protocol to Arc Testnet as the final step. |

Progress toward the Arc Testnet launch is tracked in the checklists inside
ADRs 0008–0015; ADR 0007 defines the process and milestone ordering.

## Related ADRs

- Frontend app ADRs live in `../../app/docs/adr/`.
- Protocol ADRs live in `../../protocol/docs/adr/`.
