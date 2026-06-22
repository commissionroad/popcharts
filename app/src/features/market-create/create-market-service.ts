import type { PublicClient, WalletClient } from "viem";
import { formatUnits, parseEventLogs } from "viem";

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

const TOKEN_DECIMALS = 18;

export type CreateMarketWallet = {
  accountAddress: `0x${string}`;
  activeChainId: number | null;
  publicClient: PublicClient;
  walletClient: WalletClient;
};

export type CreateMarketOptions = {
  wallet?: CreateMarketWallet;
};

export type SubmittedMarketReview = ReturnType<typeof buildCreateMarketPreview> & {
  aiReview: {
    source: "local" | "webhook";
    status: "eligible" | "forwarded";
  };
  reviewId: string;
  reviewStatus: "queued";
  submittedAt: string;
};

type SubmitMarketReviewResponse = {
  aiReview: SubmittedMarketReview["aiReview"];
  reviewId: string;
  status: SubmittedMarketReview["reviewStatus"];
  submittedAt: string;
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
    return createWalletSignedMarket(chainPreview, config.chainId, options.wallet);
  }

  return createServerSignedMarket(chainPreview, config.chainId);
}

export async function submitMarketForReview(
  draft: CreateMarketDraft
): Promise<SubmittedMarketReview> {
  const errors = validateCreateMarketDraft(draft);

  if (Object.keys(errors).length > 0) {
    throw new Error("Cannot submit an invalid market draft.");
  }

  const preview = buildCreateMarketPreview(draft);
  const response = await fetch("/api/market-review/submissions", {
    body: JSON.stringify({
      collateralSymbol: preview.collateralSymbol,
      graduationThreshold: preview.graduationThreshold,
      metadata: preview.metadata,
      metadataHash: preview.metadataHash,
      protocolParams: serializeProtocolCreateMarketParams(preview.protocolParams),
    }),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });
  const body = (await response.json().catch(() => null)) as unknown;

  if (!response.ok || !isSubmitMarketReviewResponse(body)) {
    throw new Error(getReviewSubmissionError(body));
  }

  return {
    ...preview,
    aiReview: body.aiReview,
    reviewId: body.reviewId,
    reviewStatus: body.status,
    submittedAt: body.submittedAt,
  };
}

async function createServerSignedMarket(
  preview: ReturnType<typeof buildCreateMarketPreview>,
  chainId: number
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

  const metadataSyncError = await persistMarketMetadata({
    chainId,
    metadata: preview.metadata,
    metadataHash: preview.metadataHash,
  });

  return {
    ...preview,
    chainId,
    creationMode: "devchain",
    creationSigner: "server",
    marketId: body.marketId,
    ...(metadataSyncError ? { metadataSyncError } : {}),
    transactionHash: body.transactionHash,
  };
}

async function createWalletSignedMarket(
  preview: ReturnType<typeof buildCreateMarketPreview>,
  chainId: number,
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

  const creationFee = await getMarketCreationFee({
    config,
    wallet,
  });

  const hash = await wallet.walletClient.writeContract({
    abi: pregradManagerAbi,
    account: wallet.accountAddress,
    address: config.pregradManagerAddress,
    chain: wallet.walletClient.chain,
    functionName: "createMarket",
    args: [preview.protocolParams],
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

  const metadataSyncError = await persistMarketMetadata({
    chainId,
    metadata: preview.metadata,
    metadataHash: preview.metadataHash,
  });

  return {
    ...preview,
    chainId,
    creationMode: "devchain",
    creationSigner: "wallet",
    creator: marketCreated.args.creator,
    marketId: marketCreated.args.marketId.toString(),
    ...(metadataSyncError ? { metadataSyncError } : {}),
    transactionHash: hash,
  };
}

async function getMarketCreationFee({
  config,
  wallet,
}: {
  config: NonNullable<ReturnType<typeof getPopChartsContractConfig>>;
  wallet: CreateMarketWallet;
}) {
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
      `Public market creation costs ${formatTokenAmount(
        fee
      )} native USDC. Your wallet has ${formatTokenAmount(balance)} available.`
    );
  }

  return fee;
}

async function persistMarketMetadata({
  chainId,
  metadata,
  metadataHash,
}: {
  chainId: number;
  metadata: ReturnType<typeof buildCreateMarketPreview>["metadata"];
  metadataHash: `0x${string}`;
}) {
  try {
    const response = await fetch("/api/indexer/market-metadata", {
      body: JSON.stringify({
        chainId,
        metadata,
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
  } catch (error) {
    return error instanceof Error
      ? error.message
      : "Market metadata could not be saved to the API.";
  }
}

function getReviewSubmissionError(body: unknown) {
  if (isRecord(body) && typeof body.error === "string") {
    return body.error;
  }

  return "The review submission service could not submit this market.";
}

function isSubmitMarketReviewResponse(
  value: unknown
): value is SubmitMarketReviewResponse {
  if (!isRecord(value) || !isRecord(value.aiReview)) {
    return false;
  }

  return (
    value.status === "queued" &&
    typeof value.reviewId === "string" &&
    typeof value.submittedAt === "string" &&
    (value.aiReview.source === "local" || value.aiReview.source === "webhook") &&
    (value.aiReview.status === "eligible" || value.aiReview.status === "forwarded")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formatTokenAmount(value: bigint) {
  const amount = Number(formatUnits(value, TOKEN_DECIMALS));

  return amount.toLocaleString("en-US", {
    maximumFractionDigits: amount >= 100 ? 0 : 2,
    minimumFractionDigits: amount > 0 && amount < 100 ? 2 : 0,
  });
}
