set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

default:
    @just --list

setup:
    pnpm run setup

dev:
    pnpm run dev

app-dev:
    pnpm run app:dev

app-build:
    pnpm run app:build

app-check:
    pnpm run app:check

app-test:
    pnpm run app:test

app-coverage:
    pnpm run app:coverage

app-smoke:
    pnpm run app:e2e:smoke

app-chain:
    pnpm run app:e2e:chain

devchain-deploy:
    pnpm run devchain:deploy

devchain-e2e:
    pnpm run devchain:e2e

observability:
    pnpm run observability

protocol-build:
    pnpm run protocol:build

protocol-check:
    pnpm run protocol:check

protocol-test:
    pnpm run protocol:test

protocol-coverage:
    pnpm run protocol:coverage

server-install:
    pnpm run server:install

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

local-create-complete-set-market:
    pnpm run local:create-complete-set-market

local-market-health:
    pnpm run local:market-health

local-market-smoke *args:
    pnpm run local:market-smoke -- {{args}}

# Emergency operator kill switch: cancel an Active market and open full refunds.
# Accepts a bare marketId ("9") or the composite "chainId:marketId" copied from
# the market detail URL ("31337:9").
cancel-market marketId:
    POPCHARTS_CANCEL_MARKET_ID="{{marketId}}" pnpm run local:cancel-market

scripts-check:
    pnpm run scripts:check

scripts-test:
    pnpm run scripts:test

test:
    pnpm run test

coverage:
    pnpm run test:coverage

check:
    pnpm run check

format:
    pnpm run format

format-check:
    pnpm run format:check

land *args:
    scripts/land {{args}}
