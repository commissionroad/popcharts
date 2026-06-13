# Protocol Agent Instructions

All Solidity protocol work belongs under this `protocol/` directory.

Before changing protocol code, read these files:

1. `CONSTITUTION.md`
2. `CONTEXT.md`
3. `docs/CODE_GUIDELINES.md`
4. `docs/TESTING.md`
5. Relevant ADRs in `docs/adr/`

Treat `../documents/whitepaper_v4.pdf` as the source of truth for mechanism
semantics. Earlier whitepapers can provide context, but they do not override
v4.

Use Hardhat 3, TypeScript, pnpm, and the viem toolbox. Prefer Solidity tests for
contract-unit behavior and TypeScript tests for deployment and integration flows.

Receipts are provisional priced intents until graduation. Never name or model
pre-graduation receipts as final fills, positions, or outcome tokens.
