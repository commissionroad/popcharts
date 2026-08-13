import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";

import { deployPregradManager } from "../../scripts/shared/deployment/deployPregradManager.js";
import { getAddress, keccak256, stringToBytes } from "viem";

import { MARKET_STATUS } from "../../src/generated/contract-enums.js";
import {
  buildMarketCreationAuthorizationTypedData,
  generateCreationAuthorizationNonce,
  type MarketCreationParams,
} from "../../src/market-creation-authorization.js";

/**
 * The cross-language vector proof for repo ADR 0022 P4: a signature built
 * from this package's typed-data definition must pass the PregradManager's
 * real `_consumeCreationAuthorization`. If either side's EIP-712 shape
 * drifts — a field renamed, reordered, or retyped — the happy path here is
 * what fails, at build time instead of at a creator's publish.
 */

const WAD = 10n ** 18n;
const METADATA = '{"version":1,"question":"Will the authorized path mint?"}';

describe("market creation authorization against the real contract", async function () {
  const { viem, networkHelpers } = await network.create();

  async function deployGatedManager() {
    const collateral = await viem.deployContract("MockCollateral");
    const manager = await deployPregradManager(viem);
    const [, authorizer] = await viem.getWalletClients();
    await manager.write.setMarketCreationAuthorizer([getAddress(authorizer.account.address)]);
    return { collateral, manager };
  }

  async function defaultParams(collateralAddress: `0x${string}`): Promise<MarketCreationParams> {
    const now = BigInt(await networkHelpers.time.latest());
    return {
      bypassAiResolution: false,
      collateral: collateralAddress,
      graduationDeadline: now + 7n * 24n * 60n * 60n,
      graduationThreshold: 2_500n * WAD,
      liquidityParameter: 5_000n * WAD,
      metadata: METADATA,
      metadataHash: keccak256(stringToBytes(METADATA)),
      openingProbabilityWad: (50n * WAD) / 100n,
      resolutionTime: now + 14n * 24n * 60n * 60n,
      yesNotBefore: now + 14n * 24n * 60n * 60n,
    };
  }

  it("mints a market born Active from a package-signed authorization", async function () {
    const { collateral, manager } = await networkHelpers.loadFixture(deployGatedManager);
    const [, authorizer, creator] = await viem.getWalletClients();

    const params = await defaultParams(collateral.address);
    const nonce = generateCreationAuthorizationNonce();
    const expiry = BigInt(await networkHelpers.time.latest()) + 900n;
    const signature = await authorizer.signTypedData(
      buildMarketCreationAuthorizationTypedData({
        chainId: authorizer.chain.id,
        creator: getAddress(creator.account.address),
        expiry,
        nonce,
        params,
        verifyingContract: manager.address,
      }),
    );

    const fee = await manager.read.MARKET_CREATION_FEE();
    await manager.write.createMarket([params, { expiry, nonce, signature }], {
      account: creator.account,
      value: fee,
    });

    // Same cast the band-pass on-chain test uses: hardhat-viem loses the
    // struct's return type through the artifact indirection.
    const state = (await manager.read.getMarketState([1n])) as { status: number };
    assert.equal(state.status, MARKET_STATUS.active);
    assert.equal(await manager.read.isCreationAuthorizationNonceUsed([nonce]), true);
  });

  it("is refused when any signed field is changed after signing", async function () {
    const { collateral, manager } = await networkHelpers.loadFixture(deployGatedManager);
    const [, authorizer, creator] = await viem.getWalletClients();

    const params = await defaultParams(collateral.address);
    const nonce = generateCreationAuthorizationNonce();
    const expiry = BigInt(await networkHelpers.time.latest()) + 900n;
    const signature = await authorizer.signTypedData(
      buildMarketCreationAuthorizationTypedData({
        chainId: authorizer.chain.id,
        creator: getAddress(creator.account.address),
        expiry,
        nonce,
        params,
        verifyingContract: manager.address,
      }),
    );

    // The signature covers every economic field, so submitting doubled
    // liquidity under it recovers a garbage signer and reverts.
    const tampered = { ...params, liquidityParameter: params.liquidityParameter * 2n };
    const fee = await manager.read.MARKET_CREATION_FEE();
    await assert.rejects(
      manager.write.createMarket([tampered, { expiry, nonce, signature }], {
        account: creator.account,
        value: fee,
      }),
      /InvalidMarketCreationAuthorization/,
    );
  });
});
