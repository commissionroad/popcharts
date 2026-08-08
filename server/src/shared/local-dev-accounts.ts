/**
 * Private key of the first default Hardhat devnet account. Every server-side
 * local-only fallback — the devchain signer, the market-creation authorizer,
 * and the resolution proposer — resolves to this one account, which also owns
 * the local deploy and so holds every operator role on it.
 *
 * This key is publicly known and must only ever fund local chains. A
 * deployment that reaches a live network supplies its own key through the
 * env var that role reads; nothing here is a production credential.
 *
 * The root scripts tree carries its own copy in
 * `scripts/shared/chain/defaultHardhatPrivateKey.ts`. The two cannot share a
 * module: the server image builds from the `server/` directory alone, so a
 * bundled entrypoint that imports across that boundary fails to build.
 */
export const DEFAULT_HARDHAT_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
