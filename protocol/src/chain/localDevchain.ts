// Default chain id of the throwaway local devchain (`pnpm devchain:node`).
// Flows branch on it to gate local-only conveniences — minting mock
// collateral, seeding bytecode — that must never run against a real chain.
export const LOCAL_DEVCHAIN_CHAIN_ID = 31_337;
