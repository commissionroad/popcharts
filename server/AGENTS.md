# Pop Charts Server Rules

- Runtime code in this package targets Bun and Elysia.
- Keep route schemas next to routes so OpenAPI output stays honest.
- When adding or changing routes or response models, follow
  `../skills/engineering/server-openapi-sync/SKILL.md`: regenerate
  `generated/openapi.json` and the app's orval client in the same PR.
- Store raw chain events before deriving API projections.
- Event handlers must be idempotent by transaction hash and log index.
- Preserve Pop Charts product language: pre-graduation buys are receipts or
  priced intents, not final positions.
- Normalize addresses to lowercase when writing database rows.
