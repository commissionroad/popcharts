import type { PublicClient, WalletClient } from "viem";
import { parseEventLogs } from "viem";

import {
  buildCreateMarketPreview,
  validateCreateMarketDraft,
} from "@/domain/market-creation/create-market";
import type { CreatedMarket, CreateMarketDraft } from "@/domain/market-creation/types";
import {
  getPopChartsContractConfig,
  marketCreationMode,
  marketCreationSigner,
} from "@/integrations/contracts/config";
import { pregradManagerAbi } from "@/integrations/contracts/pregrad-manager";
import { serializeProtocolCreateMarketParams } from "@/integrations/contracts/protocol-params";

export type CreateMarketWallet = {
  accountAddress: `0x${string}`;
  activeChainId: number | null;
  publicClient: PublicClient;
  walletClient: WalletClient;
};

export type CreateMarketOptions = {
  wallet?: CreateMarketWallet;
};

export async function createMockMarket(
  draft: CreateMarketDraft
): Promise<CreatedMarket> {
  const errors = validateCreateMarketDraft(draft);

  if (Object.keys(errors).length > 0) {
    throw new Error("Cannot create an invalid market draft.");
  }

  const preview = buildCreateMarketPreview(draft);

  await new Promise((resolve) => window.setTimeout(resolve, 180));

  return {
    ...preview,
    creationMode: "mock",
    marketId: `draft-${preview.metadataHash.slice(2, 8)}`,
  };
}

export async function createMarket(
  draft: CreateMarketDraft,
  options: CreateMarketOptions = {}
): Promise<CreatedMarket> {
  if (marketCreationMode !== "devchain") {
    return createMockMarket(draft);
  }

  const errors = validateCreateMarketDraft(draft);

  if (Object.keys(errors).length > 0) {
    throw new Error("Cannot create an invalid market draft.");
  }

  const config = getPopChartsContractConfig();

  if (!config) {
    throw new Error("Devchain contract configuration is incomplete.");
  }

  const preview = buildCreateMarketPreview(draft);
  const chainPreview = {
    ...preview,
    protocolParams: {
      ...preview.protocolParams,
      collateral: config.collateralAddress,
    },
  };

  if (marketCreationSigner === "wallet") {
    return createWalletSignedMarket(chainPreview, options.wallet);
  }

  return createServerSignedMarket(chainPreview);
}

async function createServerSignedMarket(
  preview: ReturnType<typeof buildCreateMarketPreview>
): Promise<CreatedMarket> {
  const response = await fetch("/api/devchain/markets", {
    body: JSON.stringify({
      metadata: preview.metadata,
      protocolParams: serializeProtocolCreateMarketParams(preview.protocolParams),
    }),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });
  const body = (await response.json()) as {
    error?: string;
    marketId?: string;
    transactionHash?: `0x${string}`;
  };

  if (!response.ok || !body.marketId || !body.transactionHash) {
    throw new Error(body.error ?? "The devchain creation service failed.");
  }

  return {
    ...preview,
    creationMode: "devchain",
    creationSigner: "server",
    marketId: body.marketId,
    transactionHash: body.transactionHash,
  };
}

async function createWalletSignedMarket(
  preview: ReturnType<typeof buildCreateMarketPreview>,
  wallet: CreateMarketWallet | undefined
): Promise<CreatedMarket> {
  const config = getPopChartsContractConfig();

  if (!config) {
    throw new Error("Devchain contract configuration is incomplete.");
  }

  if (!wallet) {
    throw new Error("Connect a wallet before creating a devchain market.");
  }

  if (wallet.activeChainId !== config.chainId) {
    throw new Error(`Switch your wallet to chain ${config.chainId} before creating.`);
  }

  const hash = await wallet.walletClient.writeContract({
    abi: pregradManagerAbi,
    account: wallet.accountAddress,
    address: config.pregradManagerAddress,
    chain: wallet.walletClient.chain,
    functionName: "createMarket",
    args: [preview.protocolParams],
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
    ...preview,
    creationMode: "devchain",
    creationSigner: "wallet",
    creator: marketCreated.args.creator,
    marketId: marketCreated.args.marketId.toString(),
    transactionHash: hash,
  };
}
