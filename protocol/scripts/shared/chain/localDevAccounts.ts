/**
 * The publicly-known development accounts derived from the standard test
 * mnemonic `test test test test test test test test test test test junk`.
 *
 * Hardhat's own devchain, Anvil, and the single-node Arc chain (ADR 0028) all
 * prefund exactly these accounts, which is what lets one set of keys drive
 * every local chain. Arc's `arc-localdev` genesis funds the first sixteen with
 * 1,000,000 native USDC each.
 *
 * These keys are public. They must never fund anything but a local chain, and
 * nothing here may ever be used to derive a key for a real network.
 *
 * A network of `type: "http"` needs these listed explicitly: the chain holding
 * a balance for an address does not tell Hardhat how to sign for it, so an
 * `accounts`-less http network cannot send a transaction even against a chain
 * that prefunds every account it would want to use.
 */
export const LOCAL_DEV_PRIVATE_KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
  "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
  "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356",
  "0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97",
  "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6",
] as const;

/**
 * The first development account's key — the default deployer for local
 * scripts when POPCHARTS_DEPLOYER_PRIVATE_KEY is unset.
 */
export const DEFAULT_LOCAL_DEV_PRIVATE_KEY = LOCAL_DEV_PRIVATE_KEYS[0];

/** Address of {@link DEFAULT_LOCAL_DEV_PRIVATE_KEY}; the two must agree. */
export const DEFAULT_LOCAL_DEV_ADDRESS =
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
