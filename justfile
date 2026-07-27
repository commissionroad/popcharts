set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

# Recipes in the 'deprecated' group are candidates for deletion. Each one is a
# thin alias whose underlying `pnpm run` script is what callers actually use:
# a scan of shell history, 671 agent transcripts, and every repo reference on
# 2026-07-27 found zero or near-zero uses of the alias while the script behind
# it stayed busy (`just format-check` 0 runs vs `pnpm run format:check` 79).
# They still work — they are marked, not broken, so that usage logging can
# judge them on real data. Review on 2026-08-24: delete the ones with no
# logged runs, and drop the attributes from any that turned out to be used.
# See scripts/just-usage/README.md for the log and the report command.

default:
    @just --list

setup:
    pnpm run setup

dev:
    pnpm run dev

[group('deprecated')]
[doc('DEPRECATED - use: pnpm run app:dev')]
app-dev:
    pnpm run app:dev

[group('deprecated')]
[doc('DEPRECATED - use: pnpm run app:build')]
app-build:
    pnpm run app:build

app-check:
    pnpm run app:check

[group('deprecated')]
[doc('DEPRECATED - use: pnpm run app:test')]
app-test:
    pnpm run app:test

[group('deprecated')]
[doc('DEPRECATED - use: pnpm run app:coverage')]
app-coverage:
    pnpm run app:coverage

[group('deprecated')]
[doc('DEPRECATED - use: pnpm run app:e2e:smoke')]
app-smoke:
    pnpm run app:e2e:smoke

[group('deprecated')]
[doc('DEPRECATED - use: pnpm run app:e2e:chain')]
app-chain:
    pnpm run app:e2e:chain

[group('deprecated')]
[doc('DEPRECATED - use: pnpm run devchain:deploy')]
devchain-deploy:
    pnpm run devchain:deploy

devchain-e2e:
    pnpm run devchain:e2e

observability:
    pnpm run observability

[group('deprecated')]
[doc('DEPRECATED - use: pnpm run protocol:build')]
protocol-build:
    pnpm run protocol:build

protocol-check:
    pnpm run protocol:check

[group('deprecated')]
[doc('DEPRECATED - use: pnpm run protocol:test')]
protocol-test:
    pnpm run protocol:test

[group('deprecated')]
[doc('DEPRECATED - use: pnpm run protocol:coverage')]
protocol-coverage:
    pnpm run protocol:coverage

server-install:
    pnpm run server:install

[group('deprecated')]
[doc('DEPRECATED - use: pnpm run server:dev')]
server-dev:
    pnpm run server:dev

server-api:
    pnpm run server:api

server-indexer:
    pnpm run server:indexer

server-ai-review-smoke:
    pnpm run server:ai-review-smoke

server-check:
    pnpm run server:check

[group('deprecated')]
[doc('DEPRECATED - use: pnpm run server:coverage')]
server-coverage:
    pnpm run server:coverage

# ADR 0019 consistency lane, local flavor: run the review-verdict evals
# against a running review service (see `just local-ai-review`), then check
# for regression against the committed local-model baseline when one exists.
verdict-evals:
    #!/usr/bin/env bash
    set -euo pipefail
    cd server
    service_url="${VERDICT_EVAL_SERVICE_URL:-http://127.0.0.1:3002}"
    out="eval-reports/verdict-evals-latest"
    bun run src/ai-review/evals/run-review-evals.ts \
        --service-url "$service_url" --out "$out"
    baseline="src/ai-review/evals/baselines/ollama-gpt-oss-20b.json"
    if [ -f "$baseline" ]; then
        bun run src/ai-review/evals/check-eval-regression.ts \
            --report "$out.json" --baseline "$baseline"
    else
        echo "No committed baseline at server/$baseline — skipping regression check."
        echo "To create one after reviewing this run: cp \"$out.json\" \"$baseline\""
        echo "(see server/src/ai-review/evals/baselines/README.md)"
    fi

local-dev *args:
    pnpm run local:dev -- {{args}}

local-dev-control *args:
    pnpm run local:dev:control -- {{args}}

local-ai-review *args:
    pnpm run local:ai-review -- {{args}}

local-dev-ai-review *args:
    pnpm run local:dev:ai-review -- {{args}}

local-bot-trade *args:
    pnpm run local:bot-trade -- {{args}}

local-bot-trade-postgrad *args:
    pnpm run local:bot-trade-postgrad -- {{args}}

local-create-market *args:
    pnpm run local:create-market -- {{args}}

local-reset:
    pnpm run local:reset

local-smoke *args:
    pnpm run local:smoke -- {{args}}

local-deploy-venue:
    pnpm run local:deploy-venue

local-deploy-postgrad:
    pnpm run local:deploy-postgrad

[group('deprecated')]
[doc('DEPRECATED - use: pnpm run local:create-complete-set-market')]
local-create-complete-set-market:
    pnpm run local:create-complete-set-market

local-market-health:
    pnpm run local:market-health

local-market-smoke *args:
    pnpm run local:market-smoke -- {{args}}

# The marketId is a bare id ("9") or the composite "chainId:marketId" copied
# from the market detail URL ("31337:9"). The optional slot names the local dev
# stack to act on, by slot number or instance id; without it the command still
# refuses to guess when several stacks are running, so naming one is the only
# way to run this non-interactively with more than one stack up (ADR 0020). The
# env() fallback keeps an inherited POPCHARTS_STACK working when no slot
# argument is given.
# Operator kill switch: cancel an Active market and open full refunds.
cancel-market marketId slot="":
    POPCHARTS_CANCEL_MARKET_ID="{{marketId}}" \
      POPCHARTS_STACK="{{ if slot != '' { slot } else { env('POPCHARTS_STACK', '') } }}" \
      pnpm run local:cancel-market

[group('deprecated')]
[doc('DEPRECATED - use: pnpm run scripts:check')]
scripts-check:
    pnpm run scripts:check

[group('deprecated')]
[doc('DEPRECATED - use: pnpm run scripts:test')]
scripts-test:
    pnpm run scripts:test

test:
    pnpm run test

[group('deprecated')]
[doc('DEPRECATED - use: pnpm run test:coverage')]
coverage:
    pnpm run test:coverage

check:
    pnpm run check

format:
    pnpm run format

[group('deprecated')]
[doc('DEPRECATED - use: pnpm run format:check')]
format-check:
    pnpm run format:check

land *args:
    scripts/land {{args}}
