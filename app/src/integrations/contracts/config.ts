import { getAddress, isAddress } from "viem";

import {
  ARC_LOCAL_CHAIN_ID,
  ARC_LOCAL_NAME,
  ARC_LOCAL_NATIVE_CURRENCY,
} from "./arc-local";
import {
  ARC_TESTNET_CHAIN_ENV,
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_NATIVE_CURRENCY,
  ARC_TESTNET_RPC_URL,
} from "./arc-testnet";

/**
 * Which deployment environment the app is pointed at.
 *
 * "local" covers *both* disposable devchains — Hardhat's (31337) and the Arc
 * single-node chain (1337) — rather than gaining an "arc-local" sibling. The
 * environment name answers "may this build behave like a throwaway chain?"
 * (open collateral minting, dev tools), which is equally true of both, while
 * everything that genuinely differs between them — display name, gas currency
 * — comes from the chain id instead. See `LOCAL_CHAIN_PROFILES` below, the
 * server's matching `NetworkId` note, and ADR 0028 G6/G15.
 */
export type PopChartsChainEnv =
  | "arc-testnet"
  | "local"
  | "mock"
  | "preview"
  | "production"
  | "testnet";

export type MarketCreationMode = "devchain" | "mock";
export type MarketCreationSigner = "server" | "wallet";
export type PopChartsNativeCurrency = {
  decimals: number;
  name: string;
  symbol: string;
};

export type PopChartsContractConfig = {
  chainEnv: PopChartsChainEnv;
  chainId: number;
  collateralAddress: `0x${string}`;
  nativeCurrency: PopChartsNativeCurrency;
  pregradManagerAddress: `0x${string}`;
  /** Review-bond escrow (ADR 0022 P3); null until the vault is deployed. */
  reviewCreditVaultAddress: `0x${string}` | null;
  rpcUrl: string;
};

const chainEnvs = new Set<PopChartsChainEnv>([
  "arc-testnet",
  "local",
  "mock",
  "preview",
  "production",
  "testnet",
]);

export const localChainEnabled =
  process.env.NEXT_PUBLIC_POPCHARTS_ENABLE_LOCAL_CHAIN === "true";

/**
 * Stock EVM gas currency. Hardhat's devchain bills gas in ETH, as does the
 * mock environment that stands in for a chain; Arc — local or testnet — does
 * not.
 */
const ETHER_NATIVE_CURRENCY = {
  decimals: 18,
  name: "Ether",
  symbol: "ETH",
} as const satisfies PopChartsNativeCurrency;

/** Hardhat's devchain id, retired with the devchain itself in ADR 0028 P5. */
const HARDHAT_LOCAL_CHAIN_ID = 31337;

/** How one local devchain names itself and charges for gas. */
export type LocalChainProfile = {
  chainId: number;
  name: string;
  nativeCurrency: PopChartsNativeCurrency;
};

/**
 * The local devchains the app can name precisely, keyed by chain id.
 *
 * Matched by exact id, never by prefix or range. `arc-local` (1337) and
 * `arc-testnet` (5042002) share a name prefix but nothing else, and Arc
 * Testnet is a shared network that must never be handled as a disposable one;
 * an exact-id table is what keeps a sloppy `startsWith` from ever being the
 * thing standing between them.
 */
const LOCAL_CHAIN_PROFILES: readonly LocalChainProfile[] = [
  {
    chainId: HARDHAT_LOCAL_CHAIN_ID,
    name: "Hardhat Local",
    nativeCurrency: ETHER_NATIVE_CURRENCY,
  },
  {
    chainId: ARC_LOCAL_CHAIN_ID,
    name: ARC_LOCAL_NAME,
    nativeCurrency: ARC_LOCAL_NATIVE_CURRENCY,
  },
];

/**
 * Describes the local devchain with this id, falling back to a generic ETH-gas
 * devchain for an id the app has never heard of — the behaviour a hand-set
 * NEXT_PUBLIC_POPCHARTS_CHAIN_ID has always had. Callers get a profile rather
 * than `undefined` so that fallback is stated once, here, instead of at every
 * call site.
 */
export function getLocalChainProfile(chainId: number): LocalChainProfile {
  return (
    LOCAL_CHAIN_PROFILES.find((profile) => profile.chainId === chainId) ?? {
      chainId,
      name: `Local Devchain ${chainId}`,
      nativeCurrency: ETHER_NATIVE_CURRENCY,
    }
  );
}

export const popChartsChainEnv = parseChainEnv(
  process.env.NEXT_PUBLIC_POPCHARTS_CHAIN_ENV,
  localChainEnabled ? "local" : ARC_TESTNET_CHAIN_ENV
);

export const marketCreationMode = parseMarketCreationMode(
  process.env.NEXT_PUBLIC_POPCHARTS_MARKET_CREATION_MODE
);

export const marketCreationSigner = parseMarketCreationSigner(
  process.env.NEXT_PUBLIC_POPCHARTS_MARKET_CREATION_SIGNER
);

/**
 * Which chain the app talks to. Local stacks pass the id their deploy actually
 * used, so pointing the app at the Arc devchain is already just
 * NEXT_PUBLIC_POPCHARTS_CHAIN_ID=1337. The unset default stays Hardhat's id
 * because ADR 0028 removes nothing before Phase 5, which is where it flips.
 */
export const configuredPopChartsChainId = localChainEnabled
  ? (parsePositiveInteger(process.env.NEXT_PUBLIC_POPCHARTS_CHAIN_ID) ??
    HARDHAT_LOCAL_CHAIN_ID)
  : ARC_TESTNET_CHAIN_ID;

export const configuredPopChartsRpcUrl = localChainEnabled
  ? process.env.NEXT_PUBLIC_POPCHARTS_RPC_URL?.trim() || "http://127.0.0.1:8545"
  : ARC_TESTNET_RPC_URL;

export function getPopChartsContractConfig(): PopChartsContractConfig | null {
  const pregradManagerAddress = parseAddress(
    process.env.NEXT_PUBLIC_POPCHARTS_PREGRAD_MANAGER_ADDRESS
  );
  const collateralAddress = parseAddress(
    process.env.NEXT_PUBLIC_POPCHARTS_COLLATERAL_ADDRESS
  );

  if (!pregradManagerAddress || !collateralAddress) {
    return null;
  }

  return {
    chainEnv: popChartsChainEnv,
    chainId: configuredPopChartsChainId,
    collateralAddress,
    nativeCurrency: getNativeCurrency(popChartsChainEnv, configuredPopChartsChainId),
    pregradManagerAddress,
    reviewCreditVaultAddress:
      parseAddress(process.env.NEXT_PUBLIC_POPCHARTS_REVIEW_CREDIT_VAULT_ADDRESS) ??
      null,
    rpcUrl: configuredPopChartsRpcUrl,
  };
}

function parseChainEnv(
  value: string | undefined,
  fallback: PopChartsChainEnv
): PopChartsChainEnv {
  if (value && chainEnvs.has(value as PopChartsChainEnv)) {
    return value as PopChartsChainEnv;
  }

  return fallback;
}

function parseMarketCreationMode(value: string | undefined): MarketCreationMode {
  return value === "devchain" ? "devchain" : "mock";
}

function parseMarketCreationSigner(value: string | undefined): MarketCreationSigner {
  return value === "server" ? "server" : "wallet";
}

function parsePositiveInteger(value: string | undefined) {
  if (!value) {
    return null;
  }

  const parsed = Number(value);

  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseAddress(value: string | undefined): `0x${string}` | null {
  const address = value?.trim();

  if (!address || !isAddress(address)) {
    return null;
  }

  return getAddress(address);
}

/**
 * What gas costs on the configured chain.
 *
 * Keyed on the chain id for local chains, not on the environment name: "local"
 * names both devchains and they disagree — Hardhat bills ETH, Arc bills USDC.
 * Reading this off the env name alone would quote ETH on a chain that has no
 * ETH.
 */
function getNativeCurrency(
  chainEnv: PopChartsChainEnv,
  chainId: number
): PopChartsNativeCurrency {
  if (chainEnv === "mock") {
    return ETHER_NATIVE_CURRENCY;
  }

  if (chainEnv === "local") {
    return getLocalChainProfile(chainId).nativeCurrency;
  }

  return ARC_TESTNET_NATIVE_CURRENCY;
}
