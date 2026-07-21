/**
 * Printed by local-chain-smoke.ts once the kept-running stack (chain, API,
 * indexer) is serving, and matched by orchestrators that hand that live
 * stack to a follow-on suite (run-lifecycle-e2e.ts). One definition so the
 * printer and matchers cannot drift.
 *
 * The nightly-lifecycle workflow's lifecycle-smoke job greps for this same
 * sentence in shell (it cannot import TypeScript) — keep the copy in
 * .github/workflows/nightly-lifecycle.yml in sync when changing it.
 */
export const SMOKE_READINESS_LINE = "Keeping Hardhat, API, and indexer running";
