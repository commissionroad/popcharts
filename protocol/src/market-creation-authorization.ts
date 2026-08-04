import { webcrypto } from "node:crypto";

import { bytesToHex, type Address, type Hex } from "viem";

/**
 * The typed-data truth for market-creation authorizations (repo ADR 0022 P4).
 *
 * This module is the single off-chain source of the EIP-712 shape the
 * PregradManager verifies in `_consumeCreationAuthorization`; the nodejs test
 * proves a signature built from these types against the real contract, so any
 * drift between the two sides fails there rather than at publish time. The
 * server mints by building this typed data and signing with the authorizer
 * key; nothing else should restate these types.
 */

/** Field order mirrors `MarketTypes.CreateMarketParams` exactly. */
export const MARKET_CREATION_AUTHORIZATION_TYPES = {
  CreateMarketParams: [
    { name: "collateral", type: "address" },
    { name: "metadataHash", type: "bytes32" },
    { name: "metadata", type: "string" },
    { name: "openingProbabilityWad", type: "uint256" },
    { name: "liquidityParameter", type: "uint256" },
    { name: "graduationThreshold", type: "uint256" },
    { name: "graduationDeadline", type: "uint64" },
    { name: "resolutionTime", type: "uint64" },
    { name: "yesNotBefore", type: "uint64" },
    { name: "bypassAiResolution", type: "bool" },
  ],
  MarketCreationAuthorization: [
    { name: "creator", type: "address" },
    { name: "params", type: "CreateMarketParams" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint64" },
  ],
} as const;

/** The `CreateMarketParams` struct as viem argument values. */
export type MarketCreationParams = {
  collateral: Address;
  metadataHash: Hex;
  metadata: string;
  openingProbabilityWad: bigint;
  liquidityParameter: bigint;
  graduationThreshold: bigint;
  graduationDeadline: bigint;
  resolutionTime: bigint;
  yesNotBefore: bigint;
  bypassAiResolution: boolean;
};

/**
 * Builds the exact typed-data payload the contract verifies. Pass the result
 * straight to a viem `signTypedData` (account- or wallet-client-bound); the
 * caller owns the key, this module owns the shape.
 *
 * The domain pins the verifying PregradManager and its chain, so a signature
 * minted for one deployment is inert on every other.
 */
export function buildMarketCreationAuthorizationTypedData({
  chainId,
  creator,
  expiry,
  nonce,
  params,
  verifyingContract,
}: {
  chainId: number;
  /** Wallet the authorization is bound to; only it can spend the signature. */
  creator: Address;
  /** Unix seconds; the contract refuses the authorization after this moment. */
  expiry: bigint;
  /** Unordered single-use value; see generateCreationAuthorizationNonce. */
  nonce: bigint;
  params: MarketCreationParams;
  verifyingContract: Address;
}) {
  return {
    domain: {
      chainId,
      name: "PregradManager",
      verifyingContract,
      version: "1",
    },
    message: { creator, expiry, nonce, params },
    primaryType: "MarketCreationAuthorization",
    types: MARKET_CREATION_AUTHORIZATION_TYPES,
  } as const;
}

/**
 * A uniformly random uint256 nonce. Randomness is the whole collision story —
 * nonces are single-use and global on-chain, so the mint path must never
 * derive them from anything enumerable (draft ids, timestamps).
 */
export function generateCreationAuthorizationNonce(): bigint {
  const bytes = new Uint8Array(32);
  webcrypto.getRandomValues(bytes);
  return BigInt(bytesToHex(bytes));
}
