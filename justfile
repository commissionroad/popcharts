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

protocol-build:
    pnpm run protocol:build

protocol-check:
    pnpm run protocol:check

protocol-test:
    pnpm run protocol:test

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

