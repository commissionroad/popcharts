import { getAddress, isAddress } from "viem";

import {
  ARC_TESTNET_CHAIN_ENV,
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_NATIVE_CURRENCY,
  ARC_TESTNET_RPC_URL,
} from "./arc-testnet";

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

const LOCAL_NATIVE_CURRENCY = {
  decimals: 18,
  name: "Ether",
  symbol: "ETH",
} as const satisfies PopChartsNativeCurrency;

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

export const configuredPopChartsChainId = localChainEnabled
  ? (parsePositiveInteger(process.env.NEXT_PUBLIC_POPCHARTS_CHAIN_ID) ?? 31337)
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
    nativeCurrency: getNativeCurrency(popChartsChainEnv),
    pregradManagerAddress,
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

function getNativeCurrency(chainEnv: PopChartsChainEnv): PopChartsNativeCurrency {
  return chainEnv === "local" || chainEnv === "mock"
    ? LOCAL_NATIVE_CURRENCY
    : ARC_TESTNET_NATIVE_CURRENCY;
}
