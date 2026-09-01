# Protocol parity fixtures

`protocol-parity-v1.json` is generated from the canonical TypeScript withdrawal and clearing exports. The Rust integration test uses it to compare exact path coordinates, free segments, matched market cap, and normalized path costs across implementations.

Regenerate it from the repository root after an intentional mechanism change:

```sh
mise exec -- pnpm --dir protocol exec tsx ../simulation/fixtures/generate-protocol-parity.mjs > simulation/fixtures/protocol-parity-v1.json
```

Review the fixture diff and update the Rust implementation or the fixture schema version as appropriate. Do not update the fixture merely to make a failing parity test green.
