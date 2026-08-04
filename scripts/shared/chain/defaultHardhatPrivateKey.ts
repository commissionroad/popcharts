/**
 * Private key of the first default Hardhat devnet account, used to sign
 * devchain transactions when POPCHARTS_DEVCHAIN_PRIVATE_KEY is not set. This
 * key is publicly known and must only ever fund local chains.
 */
export const DEFAULT_HARDHAT_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

/**
 * Address of the same first default Hardhat account. Paired with the key
 * above so root scripts (which carry no chain tooling) can name the account
 * without deriving it; the two must always describe the same wallet.
 */
export const DEFAULT_HARDHAT_ACCOUNT_ADDRESS =
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
