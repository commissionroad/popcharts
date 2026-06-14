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

app-smoke:
    pnpm run app:e2e:smoke

app-chain:
    pnpm run app:e2e:chain

devchain-deploy:
    pnpm run devchain:deploy

devchain-e2e:
    pnpm run devchain:e2e

protocol-build:
    pnpm run protocol:build

protocol-check:
    pnpm run protocol:check

protocol-test:
    pnpm run protocol:test

server-install:
    pnpm run server:install

server-dev:
    pnpm run server:dev

server-api:
    pnpm run server:api

server-indexer:
    pnpm run server:indexer

server-check:
    pnpm run server:check

local-dev:
    pnpm run local:dev

local-reset:
    pnpm run local:reset

local-smoke *args:
    pnpm run local:smoke -- {{args}}

test:
    pnpm run test

check:
    pnpm run check

format:
    pnpm run format

format-check:
    pnpm run format:check

land *args:
    scripts/land {{args}}
