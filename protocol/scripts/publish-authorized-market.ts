import { network } from "hardhat";
import { getAddress, isAddress, parseEventLogs, type Address } from "viem";

import { pregradManagerAbi } from "../src/generated/pregrad-manager.js";

/**
 * Sends the authorized `createMarket` for a server-minted publish payload
 * (repo ADR 0022 P4/P5). The API's draft flow resolves the params and signs
 * the authorization; this helper owns only the one on-chain action, exactly
 * like create-local-market.ts does for trusted tooling creation. The sender
 * defaults to the local chain's first account — the same wallet the root
 * `local-create-market` command binds its authorization to.
 *
 * Input arrives as one JSON env var (POPCHARTS_PUBLISH_PAYLOAD) because the
 * payload crosses a process boundary from the root orchestrator, which has no
 * chain tooling of its own.
 */

type SerializedPublishPayload = {
  params: {
    bypassAiResolution: boolean;
    collateral: string;
    graduationDeadline: string;
    graduationThreshold: string;
    liquidityParameter: string;
    metadata: string;
    metadataHash: string;
    openingProbabilityWad: string;
    resolutionTime: string;
    yesNotBefore: string;
  };
  authorization: {
    expiry: string;
    nonce: string;
    signature: string;
  };
};

const managerAddress = readAddress("PREGRAD_MANAGER_ADDRESS");
const rawPayload = process.env.POPCHARTS_PUBLISH_PAYLOAD;

if (!rawPayload) {
  throw new Error("POPCHARTS_PUBLISH_PAYLOAD is required (JSON params + authorization).");
}

const payload = JSON.parse(rawPayload) as SerializedPublishPayload;

if (!isAddress(payload.params.collateral)) {
  throw new Error(
    `Payload collateral must be an EVM address; received ${payload.params.collateral}`,
  );
}

const { viem } = await network.create();
const [creator] = await viem.getWalletClients();

if (!creator) {
  throw new Error("Expected the local Hardhat network to expose a creator account.");
}

const publicClient = await viem.getPublicClient();
const manager = await viem.getContractAt("PregradManager", managerAddress);
const creationFee = (await manager.read.marketCreationFee([
  getAddress(creator.account.address),
])) as bigint;

const transactionHash = await manager.write.createMarket(
  [
    {
      bypassAiResolution: payload.params.bypassAiResolution,
      collateral: getAddress(payload.params.collateral),
      graduationDeadline: BigInt(payload.params.graduationDeadline),
      graduationThreshold: BigInt(payload.params.graduationThreshold),
      liquidityParameter: BigInt(payload.params.liquidityParameter),
      metadata: payload.params.metadata,
      metadataHash: payload.params.metadataHash as `0x${string}`,
      openingProbabilityWad: BigInt(payload.params.openingProbabilityWad),
      resolutionTime: BigInt(payload.params.resolutionTime),
      yesNotBefore: BigInt(payload.params.yesNotBefore),
    },
    {
      expiry: BigInt(payload.authorization.expiry),
      nonce: BigInt(payload.authorization.nonce),
      signature: payload.authorization.signature as `0x${string}`,
    },
  ],
  { value: creationFee },
);

const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash });
const created = parseEventLogs({
  abi: pregradManagerAbi,
  eventName: "MarketCreated",
  logs: receipt.logs,
})[0];

if (!created) {
  throw new Error("Transaction succeeded but MarketCreated was not emitted.");
}

// One parseable line for the root orchestrator, same shape create-local-market
// emits, so parseSmokeMarket handles both.
emitJson("LOCAL_CHAIN_SMOKE_MARKET", {
  blockNumber: receipt.blockNumber.toString(),
  chainId: await publicClient.getChainId(),
  marketId: created.args.marketId.toString(),
  metadataHash: created.args.metadataHash,
  transactionHash,
});

function readAddress(name: string): Address {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  if (!isAddress(value)) {
    throw new Error(`${name} must be an EVM address; received ${value}`);
  }

  return getAddress(value);
}

function emitJson(label: string, value: unknown) {
  console.log(`${label}=${JSON.stringify(value)}`);
}
