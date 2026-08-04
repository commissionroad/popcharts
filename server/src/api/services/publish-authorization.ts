import {
  buildMarketCreationAuthorizationTypedData,
  generateCreationAuthorizationNonce,
  type MarketCreationParams,
} from "@popcharts/protocol";
import { privateKeyToAccount } from "viem/accounts";

import { config, ZERO_ADDRESS } from "src/config";

/**
 * How long a minted publish authorization stays valid. Minutes on purpose
 * (ADR 0022 P4 decisions): the signed params carry absolute deadlines
 * resolved at mint time, so this window is exactly how far a market's dates
 * can drift from what was reviewed. The app re-mints on expiry rather than
 * surfacing an error — minting is free.
 */
export const PUBLISH_AUTHORIZATION_TTL_SECONDS = 15n * 60n;

const DEFAULT_LOCAL_AUTHORIZER_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

/** Wire shape of a minted authorization; bigints as strings. */
export type SerializedPublishAuthorization = {
  expiry: string;
  nonce: string;
  signature: string;
};

/**
 * The authorizer key, if this deployment holds one. A dedicated env var —
 * deliberately NOT the review-manager key, so ADR 0022 P5 can retire that key
 * without renaming this one — with the same local fallback every operator
 * role uses (hardhat account #0, which also owns the local deploy and so can
 * arm the contract). Returns undefined rather than throwing: an unarmed
 * deployment mints params without an authorization, and the app decides
 * whether that is acceptable.
 */
export function readMarketCreationAuthorizerPrivateKey(
  env: Record<string, string | undefined> = process.env,
  networkName = config.name,
): `0x${string}` | undefined {
  const value =
    env.POPCHARTS_MARKET_CREATION_AUTHORIZER_PRIVATE_KEY ??
    (networkName === "local"
      ? DEFAULT_LOCAL_AUTHORIZER_PRIVATE_KEY
      : undefined);

  return value as `0x${string}` | undefined;
}

/**
 * Signs a creation authorization for one creator and one exact param set,
 * through the typed-data definition the protocol package shares with the
 * contract. Returns undefined when this deployment cannot mint — no
 * authorizer key, or the manager address is not configured — so callers
 * degrade to unauthorized params instead of failing the publish flow.
 */
export async function mintPublishAuthorization({
  chainSeconds,
  creator,
  params,
}: {
  /** Current chain time; expiry anchors here because the contract compares block time. */
  chainSeconds: bigint;
  creator: `0x${string}`;
  params: MarketCreationParams;
}): Promise<SerializedPublishAuthorization | undefined> {
  const key = readMarketCreationAuthorizerPrivateKey();

  if (!key || config.contracts.pregradManager === ZERO_ADDRESS) {
    return undefined;
  }

  const nonce = generateCreationAuthorizationNonce();
  const expiry = chainSeconds + PUBLISH_AUTHORIZATION_TTL_SECONDS;
  const signature = await privateKeyToAccount(key).signTypedData(
    buildMarketCreationAuthorizationTypedData({
      chainId: config.chainId,
      creator,
      expiry,
      nonce,
      params,
      verifyingContract: config.contracts.pregradManager,
    }),
  );

  return {
    expiry: expiry.toString(),
    nonce: nonce.toString(),
    signature,
  };
}
