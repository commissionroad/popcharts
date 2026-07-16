# Resolution-outcome evals (ADR 0019)

Labeled seed dataset (`dataset/`) plus a runner
(`run-resolution-evals.ts`) that measure the resolution service's OUTCOME
quality (`yes` / `no` / `draw` / `too_early` / `abstain`) against a running
service instance. This is the resolution sibling of
`src/ai-review/evals/`; the taxonomy and label policy live in
`docs/ai-verdict-failure-taxonomy.md`.

Cases carry no `[heuristic-outcome: ...]` markers — they measure the LLM
path, never the deterministic heuristic.

## Starting an ad-hoc Ollama service instance for evals

The eval runner never starts the service; run one yourself. From `server/`:

```sh
AI_RESOLUTION_TIMEOUT_MS=300000 \
AI_RESOLUTION_PORT=3004 \
AI_RESOLUTION_PROVIDER=ollama \
bun run start:ai-resolution
```

Env knobs (read once at startup, `src/ai-resolution/config.ts`):

| Variable                             | Default                  | Notes                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AI_RESOLUTION_PROVIDER`             | `ollama`                 | `ollama`, `anthropic`, or `heuristic` (heuristic always abstains on these cases — pointless for evals).                                                                                                                                                                                                                                                      |
| `AI_RESOLUTION_PORT`                 | `3004`                   | Also the runner's default `--service-url` port.                                                                                                                                                                                                                                                                                                              |
| `AI_RESOLUTION_TIMEOUT_MS`           | `8000`                   | **Set this to `300000` explicitly.** The 8 s default covers the whole Ollama call; local models routinely take minutes per resolution, and every timed-out run fail-safes to `manual_review`/`service_error`, which the runner counts as an error, wasting the run. (The review side's 8 s default already cost us a full eval run — do not repeat it here.) |
| `AI_RESOLUTION_OLLAMA_MODEL`         | `gpt-oss:20b`            | The Ollama model tag; pull it first (`ollama pull gpt-oss:20b`).                                                                                                                                                                                                                                                                                             |
| `OLLAMA_BASE_URL`                    | `http://127.0.0.1:11434` | Where the Ollama daemon listens.                                                                                                                                                                                                                                                                                                                             |
| `AI_RESOLUTION_INTERNET_ACCESS`      | `search`                 | `off` / `provided_urls` / `search`. Ollama cannot browse, so evidence is pre-collected through the safe-web path per this mode; the clear-YES/NO cases assume search or pre-trained knowledge.                                                                                                                                                               |
| `AI_RESOLUTION_ABSTENTION_THRESHOLD` | `0.85`                   | Confidence floor for auto-resolve; affects the recorded verdict, not the graded outcome.                                                                                                                                                                                                                                                                     |

Sanity-check readiness before a run: `curl http://127.0.0.1:3004/ready`
(reports the active provider and prompt version; 503 until ready).

## Running the evals

From `server/`:

```sh
bun run src/ai-resolution/evals/run-resolution-evals.ts \
  [--service-url http://127.0.0.1:3004] [--runs 3] \
  [--filter timing/] [--limit 10] [--out my-report]
```

`--filter` matches taxonomy-class or case-id prefixes. Reports (JSON +
markdown) land in `server/eval-reports/` (gitignored) by default.

Scoring: each case runs N times; the majority outcome must land in the
case's acceptable set (accuracy) or equal its single expected outcome
(strict). Runs whose response carries the `service_error` hard flag
(provider outage/timeout fail-safe) count as errors, not outcomes. The
derived on-chain verdict (`resolve_yes` / `resolve_no` / `cancel_draw` /
`requeue_too_early` / `manual_review`) is recorded per run for inspection
but not graded — it additionally depends on the confidence/evidence gates
in `resolver.ts`.
