import hre, { network } from "hardhat";
import { erc20Abi, formatUnits, getAddress, parseEventLogs, type Abi } from "viem";

import { getWalletClientAddress } from "./shared/account/getWalletClientAddress.js";
import { resolveDeploymentChainProfile } from "./shared/chain/resolveDeploymentChainProfile.js";
import { assertDeployedBytecode } from "./shared/contract/assertDeployedBytecode.js";
import { assertHardhatNetwork } from "./shared/hardhat/assertHardhatNetwork.js";
import { COMPLETE_SET_MARKET_STATUS } from "./shared/market/completeSetMarketStatus.js";
import { floorOutcomeToCollateralUnit } from "./shared/market/floorOutcomeToCollateralUnit.js";
import { outcomeCapacityForCollateral } from "./shared/market/outcomeCapacityForCollateral.js";
import { readCompleteSetMarketManifest } from "./shared/market/readCompleteSetMarketManifest.js";
import { readErc20Balance } from "./shared/viem/readErc20Balance.js";
import { requireSuccessfulReceipt } from "./shared/viem/requireSuccessfulReceipt.js";

// MarketTypes.Side enum values.
const SIDE_YES = 0;
const SIDE_NO = 1;
const LOSING_SIDE_ERROR = "LosingSideCannotRedeem";

/**
 * Smoke flow 4 (protocol MVP tracker item 3): resolves the market as YES via
 * the resolver account, verifies that losing-side redemption reverts, redeems
 * the account's winning YES tokens, and checks collateral conservation — the
 * market's remaining collateral must cover the entire outstanding winning
 * supply with no shortfall.
 */
async function main() {
  const connection = await network.create();
  const profile = resolveDeploymentChainProfile(connection.networkName);
  const publicClient = await connection.viem.getPublicClient();
  const [walletClient] = await connection.viem.getWalletClients();
  if (walletClient === undefined) {
    throw new Error(
      `Expected Hardhat network ${profile.networkName} to expose a smoke account. ` +
        "Set POPCHARTS_DEPLOYER_PRIVATE_KEY.",
    );
  }
  const account = getWalletClientAddress({
    missingMessage:
      `Expected Hardhat network ${profile.networkName} to expose a smoke account. ` +
      "Set POPCHARTS_DEPLOYER_PRIVATE_KEY.",
    walletClient,
  });
  const chainId = await assertHardhatNetwork({
    expectedChainId: profile.chainId,
    expectedNetworkName: profile.networkName,
    networkName: connection.networkName,
    publicClient,
  });
  const { manifest, manifestPath } = await readCompleteSetMarketManifest({
    chainEnv: profile.chainEnv,
    env: process.env,
    expectedChainId: chainId,
    protocolRoot: hre.config.paths.root,
  });

  console.log("Pop Charts smoke flow: resolution and redeem");
  console.log(`Chain: ${profile.chainName} (${chainId})`);
  console.log(`Market: ${manifest.market.symbol} at ${manifest.market.address} (${manifestPath})`);
  console.log(`Account: ${account}`);

  for (const [name, address] of [
    ["market", manifest.market.address],
    ["yesToken", manifest.market.yesToken],
    ["noToken", manifest.market.noToken],
    ["collateral", manifest.collateral.address],
  ] as const) {
    await assertDeployedBytecode(publicClient, name, address);
  }

  const market = await connection.viem.getContractAt(
    "CompleteSetBinaryMarket",
    manifest.market.address,
  );

  // Resolve as YES through the resolver account.
  const status = Number(await market.read.status());
  if (status === COMPLETE_SET_MARKET_STATUS.trading) {
    if (getAddress(manifest.market.resolver) !== account) {
      throw new Error(
        `Connected account ${account} is not the market resolver ` +
          `${manifest.market.resolver}. Run this flow with the resolver key ` +
          "(POPCHARTS_DEPLOYER_PRIVATE_KEY) or recreate the market with " +
          "POPCHARTS_MARKET_RESOLVER set to this account.",
      );
    }
    const resolveHash = await market.write.resolve([SIDE_YES]);
    await requireSuccessfulReceipt(publicClient, resolveHash, "resolve");
    console.log(`Resolved market as YES (${resolveHash}).`);
  } else if (status === COMPLETE_SET_MARKET_STATUS.resolved) {
    console.log("Market is already resolved; continuing with redemption checks.");
  } else {
    throw new Error(
      `Market ${manifest.market.address} has status ${status} (cancelled); the resolution smoke ` +
        "needs a Trading or Resolved market. Recreate it with pnpm local:create-complete-set-market.",
    );
  }

  const statusAfter = Number(await market.read.status());
  const winningSide = Number(await market.read.winningSide());
  if (statusAfter !== COMPLETE_SET_MARKET_STATUS.resolved || winningSide !== SIDE_YES) {
    throw new Error(
      `Market resolution readback failed (status ${statusAfter}, winningSide ${winningSide}).`,
    );
  }

  // The losing side must never redeem, regardless of balances.
  const oneOutcomeToken = 10n ** BigInt(manifest.market.outcomeDecimals);
  let losingSideReverted = false;
  try {
    await market.simulate.redeem([SIDE_NO, oneOutcomeToken], { account });
  } catch (error) {
    losingSideReverted = true;
    if (!String(error).includes(LOSING_SIDE_ERROR)) {
      throw new Error(
        `Losing-side redeem reverted, but not with ${LOSING_SIDE_ERROR}: ${String(error)}`,
      );
    }
  }
  if (!losingSideReverted) {
    throw new Error("Losing-side (NO) redeem simulation did not revert after a YES resolution.");
  }
  console.log(`Losing-side redeem correctly reverts with ${LOSING_SIDE_ERROR}.`);

  // Redeem the account's winning YES tokens.
  const yesBalance = await readErc20Balance(publicClient, manifest.market.yesToken, account);
  const redeemAmount = floorOutcomeToCollateralUnit({
    collateralDecimals: manifest.collateral.decimals,
    outcomeAmount: yesBalance,
    outcomeDecimals: manifest.market.outcomeDecimals,
  });
  if (redeemAmount <= 0n) {
    throw new Error(
      `Account ${account} holds no redeemable YES tokens. Run the earlier smoke flows first ` +
        "(pnpm local:smoke-maker-order, pnpm local:smoke-taker-swap, pnpm local:smoke-arb).",
    );
  }
  const collateralBefore = await readErc20Balance(
    publicClient,
    manifest.collateral.address,
    account,
  );
  const redeemHash = await market.write.redeem([SIDE_YES, redeemAmount]);
  const redeemReceipt = await requireSuccessfulReceipt(publicClient, redeemHash, "redeem");
  const collateralAfter = await readErc20Balance(
    publicClient,
    manifest.collateral.address,
    account,
  );

  const marketAbi = (await hre.artifacts.readArtifact("CompleteSetBinaryMarket")).abi as Abi;
  const redeemedEvents = parseEventLogs({
    abi: marketAbi,
    eventName: "Redeemed",
    logs: redeemReceipt.logs.filter((log) => getAddress(log.address) === manifest.market.address),
  });
  const redeemedEvent = redeemedEvents[0];
  if (redeemedEvents.length !== 1 || redeemedEvent === undefined) {
    throw new Error(
      `redeem ${redeemHash} emitted ${redeemedEvents.length} Redeemed events, expected 1.`,
    );
  }
  const redeemed = redeemedEvent.args as { collateralAmount: bigint; outcomeAmount: bigint };
  if (collateralAfter - collateralBefore !== redeemed.collateralAmount) {
    throw new Error(
      `Redeem paid ${collateralAfter - collateralBefore} collateral raw units, but the Redeemed ` +
        `event reports ${redeemed.collateralAmount}.`,
    );
  }
  console.log(
    `Redeemed ${formatUnits(redeemed.outcomeAmount, manifest.market.outcomeDecimals)} YES for ` +
      `${formatUnits(redeemed.collateralAmount, manifest.collateral.decimals)} collateral.`,
  );

  // Collateral conservation: escrow must still cover every outstanding
  // winning token; losing supply is worthless and needs no backing.
  const marketCollateral = await readErc20Balance(
    publicClient,
    manifest.collateral.address,
    manifest.market.address,
  );
  const yesSupply = await publicClient.readContract({
    abi: erc20Abi,
    address: manifest.market.yesToken,
    functionName: "totalSupply",
  });
  const noSupply = await publicClient.readContract({
    abi: erc20Abi,
    address: manifest.market.noToken,
    functionName: "totalSupply",
  });
  const backedOutcomeCapacity = outcomeCapacityForCollateral({
    collateralAmount: marketCollateral,
    collateralDecimals: manifest.collateral.decimals,
    outcomeDecimals: manifest.market.outcomeDecimals,
  });
  console.log(
    `Remaining supplies: YES ${formatUnits(yesSupply, manifest.market.outcomeDecimals)}, ` +
      `NO ${formatUnits(noSupply, manifest.market.outcomeDecimals)} (NO is unredeemable).`,
  );
  console.log(
    `Market escrow: ${formatUnits(marketCollateral, manifest.collateral.decimals)} collateral ` +
      `covering ${formatUnits(backedOutcomeCapacity, manifest.market.outcomeDecimals)} winning tokens.`,
  );
  if (backedOutcomeCapacity < yesSupply) {
    throw new Error(
      `Collateral shortfall: escrow covers ${backedOutcomeCapacity} outcome raw units but ` +
        `${yesSupply} winning YES raw units remain outstanding.`,
    );
  }
  console.log("Collateral conservation holds: no shortfall against the remaining winning supply.");
}

await main();
