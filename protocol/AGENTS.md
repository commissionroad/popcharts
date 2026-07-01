# Protocol Agent Instructions

All Solidity protocol work belongs under this `protocol/` directory.

Before changing protocol code, read these files:

1. `CONSTITUTION.md`
2. `CONTEXT.md`
3. `docs/CODE_GUIDELINES.md`
4. `docs/TESTING.md`
5. Relevant ADRs in `docs/adr/`
6. `skills/engineering/protocol-code-quality/SKILL.md`

Treat `../documents/whitepaper_v4.pdf` as the source of truth for mechanism
semantics. Earlier whitepapers can provide context, but they do not override
v4.

Use Hardhat 3, TypeScript, pnpm, and the viem toolbox. Prefer Solidity tests for
contract-unit behavior and TypeScript tests for deployment and integration flows.
New protocol scripts, script helpers, deployment tasks, and tests should be
plain `.ts` by default. Use `.mjs` only when direct Node execution is genuinely
required and the PR explains why; do not introduce `.mts` or `.d.mts` bridges for
new TypeScript work when Hardhat can run the `.ts` entrypoint.

Receipts are provisional priced intents until graduation. Never name or model
pre-graduation receipts as final fills, positions, or outcome tokens.

Do not name protocol contracts, functions, tests, scripts, deployment artifacts,
or implementation docs after third-party companies, protocols, or products. Use
descriptive mechanism names such as complete-set market, postgrad adapter, or
bounded v4 venue. Mention third-party names only for citations or historical
research context.
