import type { MarketDraftPublishParams } from "@popcharts/api-client/models";
import { parseEventLogs } from "viem";

import { getPopChartsContractConfig } from "@/integrations/contracts/config";
import { pregradManagerAbi } from "@/integrations/contracts/pregrad-manager";
import { parseSerializedProtocolCreateMarketParams } from "@/integrations/contracts/protocol-params";
import { formatTokenAmount } from "@/lib/format";

import type { PublicClient, WalletClient } from "viem";

/** The connected wallet trio a publish signs and confirms with. */
export type CreateMarketWallet = {
  accountAddress: `0x${string}`;
  activeChainId: number | null;
  publicClient: PublicClient;
  walletClient: WalletClient;
};

/** A confirmed on-chain publish: the market the approved draft became. */
export type PublishedDraftMarket = {
  chainId: number;
  creator: `0x${string}`;
  marketId: string;
  transactionHash: `0x${string}`;
};

/**
 * Signs and lands the authorized `createMarket` for an approved draft using
 * the params and creation authorization the server minted at publish time
 * (ADR 0022 §4–5). Every field is server-pinned — the signature covers the
 * full struct, so the app submits the payload byte-for-byte, adding nothing.
 * Pays the creation fee via msg.value and confirms via the MarketCreated
 * event, so the returned marketId is the chain's own answer.
 *
 * `remint` handles the one clock this flow owns: authorizations live 15
 * minutes, so a wallet prompt left open past that reverts with
 * MarketCreationAuthorizationExpired — minting is free, so the flow fetches a
 * fresh set and retries once instead of surfacing an error.
 */
export async function publishDraftMarket({
  params,
  remint,
  wallet,
}: {
  params: MarketDraftPublishParams;
  /** Fetches fresh params + authorization after an on-chain expiry revert. */
  remint?: () => Promise<MarketDraftPublishParams>;
  wallet: CreateMarketWallet;
}): Promise<PublishedDraftMarket> {
  const config = getPopChartsContractConfig();

  if (!config) {
    throw new Error("Devchain contract configuration is incomplete.");
  }

  if (wallet.activeChainId !== config.chainId) {
    throw new Error(`Switch your wallet to chain ${config.chainId} before publishing.`);
  }

  try {
    return await submitAuthorizedCreateMarket({ config, params, wallet });
  } catch (error) {
    if (!remint || !isAuthorizationExpiredError(error)) {
      throw error;
    }

    return submitAuthorizedCreateMarket({ config, params: await remint(), wallet });
  }
}

async function submitAuthorizedCreateMarket({
  config,
  params,
  wallet,
}: {
  config: NonNullable<ReturnType<typeof getPopChartsContractConfig>>;
  params: MarketDraftPublishParams;
  wallet: CreateMarketWallet;
}): Promise<PublishedDraftMarket> {
  const authorization = params.authorization;

  if (!authorization) {
    throw new Error(
      "This stack cannot authorize publishes — the API minted no creation authorization. Arm the market-creation authorizer and retry."
    );
  }

  if (params.collateral.toLowerCase() !== config.collateralAddress.toLowerCase()) {
    // The signature binds the server's collateral; submitting the app's would
    // just revert on-chain with a recovery error. Fail here with the real
    // cause instead.
    throw new Error(
      "The API signed a different collateral than this app is configured for."
    );
  }

  const protocolParams = parseSerializedProtocolCreateMarketParams(params);
  const creationFee = await readCreationFee(wallet);
  const hash = await wallet.walletClient.writeContract({
    abi: pregradManagerAbi,
    account: wallet.accountAddress,
    address: config.pregradManagerAddress,
    chain: wallet.walletClient.chain,
    functionName: "createMarket",
    args: [
      protocolParams,
      {
        expiry: BigInt(authorization.expiry),
        nonce: BigInt(authorization.nonce),
        signature: authorization.signature as `0x${string}`,
      },
    ],
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
 * Matches the contract's expiry revert wherever viem surfaces it — the
 * decoded custom error name appears in the message chain when the full ABI
 * is attached to the write.
 */
function isAuthorizationExpiredError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const seen: string[] = [];
  let current: unknown = error;
  while (current instanceof Error && seen.length < 5) {
    seen.push(current.message);
    current = current.cause;
  }

  return seen.some((message) => message.includes("MarketCreationAuthorizationExpired"));
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
