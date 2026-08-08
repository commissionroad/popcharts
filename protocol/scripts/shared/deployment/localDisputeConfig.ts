/**
 * Dispute configuration stamped into locally deployed CompleteSetPostgradAdapters.
 * Keeping local at zero is a locked user decision; repo ADR 0024 Phase 1 records
 * the mechanics: "Local deploy seams pin both to zero through
 * `scripts/shared/deployment/localDisputeConfig.ts`, which keeps the legacy
 * direct-`resolve()` path working until Phase 3 lands." Deployed networks pass
 * explicit values through the deploy seam instead (resolveDisputeConfig.ts) —
 * setDisputeConfig remains the post-deploy retune path only.
 * One definition so every local deploy seam agrees (coordination constant).
 */
export const LOCAL_DISPUTE_CONFIG = {
  disputeBond: 0n,
  disputeWindow: 0n,
} as const;

/** Constructor-argument order expected by CompleteSetPostgradAdapter. */
export function localDisputeConfigArgs(): readonly [bigint, bigint] {
  return [LOCAL_DISPUTE_CONFIG.disputeWindow, LOCAL_DISPUTE_CONFIG.disputeBond];
}
