import type { MarketDraftPublishParams } from "@popcharts/api-client/models";
import { parseEventLogs } from "viem";

import { getPopChartsContractConfig } from "@/integrations/contracts/config";
import { pregradManagerAbi } from "@/integrations/contracts/pregrad-manager";
import { parseSerializedProtocolCreateMarketParams } from "@/integrations/contracts/protocol-params";
import { formatTokenAmount } from "@/lib/format";

import type { CreateMarketWallet } from "./create-market-service";

/** A confirmed on-chain publish: the market the approved draft became. */
export type PublishedDraftMarket = {
  chainId: number;
  creator: `0x${string}`;
  marketId: string;
  transactionHash: `0x${string}`;
};

/**
 * Signs and lands `createMarket` for an approved draft using the params the
 * server minted at publish time (ADR 0022 §4) — the app adds only its
 * configured collateral address. Pays the creation fee via msg.value and
 * confirms via the MarketCreated event, so the returned marketId is the
 * chain's own answer.
 */
export async function publishDraftMarket({
  params,
  wallet,
}: {
  params: MarketDraftPublishParams;
  wallet: CreateMarketWallet;
}): Promise<PublishedDraftMarket> {
  const config = getPopChartsContractConfig();

  if (!config) {
    throw new Error("Devchain contract configuration is incomplete.");
  }

  if (wallet.activeChainId !== config.chainId) {
    throw new Error(`Switch your wallet to chain ${config.chainId} before publishing.`);
  }

  const protocolParams = parseSerializedProtocolCreateMarketParams({
    ...params,
    collateral: config.collateralAddress,
  });
  const creationFee = await readCreationFee(wallet);
  const hash = await wallet.walletClient.writeContract({
    abi: pregradManagerAbi,
    account: wallet.accountAddress,
    address: config.pregradManagerAddress,
    chain: wallet.walletClient.chain,
    functionName: "createMarket",
    args: [protocolParams],
    value: creationFee,
  });
  const receipt = await wallet.publicClient.waitForTransactionReceipt({ hash });
  const logs = parseEventLogs({
    abi: pregradManagerAbi,
    eventName: "MarketCreated",
    logs: receipt.logs,
  });
  const marketCreated = logs[0];

  if (!marketCreated) {
    throw new Error("Transaction succeeded but MarketCreated was not emitted.");
  }

  return {
    chainId: config.chainId,
    creator: marketCreated.args.creator,
    marketId: marketCreated.args.marketId.toString(),
    transactionHash: hash,
  };
}

/**
 * Best-effort display-metadata sync after a publish, mirroring the existing
 * create flow: the on-chain event is the source of truth, this fills the
 * API's display table. Returns an error message instead of throwing so a sync
 * hiccup never obscures a successful publish.
 */
export async function persistPublishedMetadata({
  chainId,
  metadataHash,
  metadataPayload,
}: {
  chainId: number;
  metadataHash: string;
  metadataPayload: string;
}): Promise<string | undefined> {
  try {
    const response = await fetch("/api/indexer/market-metadata", {
      body: JSON.stringify({
        chainId,
        metadata: JSON.parse(metadataPayload) as Record<string, unknown>,
        metadataHash,
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    });

    if (response.ok) {
      return undefined;
    }

    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    return body?.error ?? "Market metadata could not be saved to the API.";
  } catch {
    return "Market metadata could not be saved to the API.";
  }
}

async function readCreationFee(wallet: CreateMarketWallet): Promise<bigint> {
  const config = getPopChartsContractConfig();

  if (!config) {
    throw new Error("Devchain contract configuration is incomplete.");
  }

  const fee = await wallet.publicClient.readContract({
    abi: pregradManagerAbi,
    address: config.pregradManagerAddress,
    functionName: "marketCreationFee",
    args: [wallet.accountAddress],
  });

  if (fee === 0n) {
    return 0n;
  }

  const balance = await wallet.publicClient.getBalance({
    address: wallet.accountAddress,
  });

  if (balance < fee) {
    throw new Error(
      `Publishing costs ${formatTokenAmount(fee)} native USDC. Your wallet has ${formatTokenAmount(balance)} available.`
    );
  }

  return fee;
}
