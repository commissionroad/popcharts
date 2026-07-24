/**
 * Dispute configuration stamped into locally deployed CompleteSetPostgradAdapters:
 * window and bond both zero, which disables the optimistic dispute flow and keeps
 * the legacy direct-resolve path working until the runner/keeper slices of repo
 * ADR 0024 land. Deployed networks tune the real values via setDisputeConfig.
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
