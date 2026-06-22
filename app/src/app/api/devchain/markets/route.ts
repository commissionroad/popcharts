import { NextResponse } from "next/server";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatUnits,
  http,
  parseEventLogs,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { getPopChartsContractConfig } from "@/integrations/contracts/config";
import { erc20Abi } from "@/integrations/contracts/erc20";
import { pregradManagerAbi } from "@/integrations/contracts/pregrad-manager";
import { parseSerializedProtocolCreateMarketParams } from "@/integrations/contracts/protocol-params";

const TOKEN_DECIMALS = 18;

export async function POST(request: Request) {
  if (!devchainWritesEnabled()) {
    return NextResponse.json(
      { error: "Devchain market creation is not enabled." },
      { status: 404 }
    );
  }

  const config = getPopChartsContractConfig();
  const privateKey = process.env.POPCHARTS_DEVCHAIN_PRIVATE_KEY;

  if (!config || !privateKey) {
    return NextResponse.json(
      { error: "Devchain contract configuration is incomplete." },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();
    const requestedParams = parseSerializedProtocolCreateMarketParams(
      isRecord(body) ? body.protocolParams : null
    );
    const params = {
      ...requestedParams,
      collateral: config.collateralAddress,
    };
    const chain = defineChain({
      id: config.chainId,
      name: config.chainEnv === "local" ? "Hardhat Local" : "Pop Charts Devchain",
      nativeCurrency: {
        decimals: 18,
        name: "Ether",
        symbol: "ETH",
      },
      rpcUrls: {
        default: {
          http: [config.rpcUrl],
        },
      },
    });
    const account = privateKeyToAccount(normalizePrivateKey(privateKey));
    const publicClient = createPublicClient({
      chain,
      transport: http(config.rpcUrl),
    });
    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(config.rpcUrl),
    });
    await ensureMarketCreationFeeReady({
      accountAddress: account.address,
      approve: async (fee) => {
        const approvalHash = await walletClient.writeContract({
          abi: erc20Abi,
          address: config.collateralAddress,
          functionName: "approve",
          args: [config.pregradManagerAddress, fee],
        });

        await publicClient.waitForTransactionReceipt({ hash: approvalHash });
      },
      collateralAddress: config.collateralAddress,
      managerAddress: config.pregradManagerAddress,
      publicClient,
    });
    const hash = await walletClient.writeContract({
      abi: pregradManagerAbi,
      address: config.pregradManagerAddress,
      functionName: "createMarket",
      args: [params],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const logs = parseEventLogs({
      abi: pregradManagerAbi,
      eventName: "MarketCreated",
      logs: receipt.logs,
    });
    const marketCreated = logs[0];

    if (!marketCreated) {
      return NextResponse.json(
        { error: "Transaction succeeded but MarketCreated was not emitted." },
        { status: 502 }
      );
    }

    return NextResponse.json({
      creator: marketCreated.args.creator,
      marketId: marketCreated.args.marketId.toString(),
      transactionHash: hash,
    });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 400 });
  }
}

function devchainWritesEnabled() {
  if (process.env.POPCHARTS_DEVCHAIN_ENABLED !== "true") {
    return false;
  }

  if (process.env.VERCEL_ENV === "production") {
    return false;
  }

  return process.env.NEXT_PUBLIC_POPCHARTS_CHAIN_ENV !== "production";
}

function normalizePrivateKey(value: string): `0x${string}` {
  const key = value.startsWith("0x") ? value : `0x${value}`;

  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error("POPCHARTS_DEVCHAIN_PRIVATE_KEY must be a 32-byte hex key.");
  }

  return key as `0x${string}`;
}

async function ensureMarketCreationFeeReady({
  accountAddress,
  approve,
  collateralAddress,
  managerAddress,
  publicClient,
}: {
  accountAddress: `0x${string}`;
  approve: (fee: bigint) => Promise<void>;
  collateralAddress: `0x${string}`;
  managerAddress: `0x${string}`;
  publicClient: ReturnType<typeof createPublicClient>;
}) {
  const fee = await publicClient.readContract({
    abi: pregradManagerAbi,
    address: managerAddress,
    functionName: "marketCreationFee",
    args: [accountAddress],
  });

  if (fee === 0n) {
    return;
  }

  const balance = await publicClient.readContract({
    abi: erc20Abi,
    address: collateralAddress,
    functionName: "balanceOf",
    args: [accountAddress],
  });

  if (balance < fee) {
    throw new Error(
      `The devchain relay signer needs ${formatTokenAmount(
        fee
      )} pUSD to create this market. It has ${formatTokenAmount(balance)} pUSD.`
    );
  }

  const allowance = await publicClient.readContract({
    abi: erc20Abi,
    address: collateralAddress,
    functionName: "allowance",
    args: [accountAddress, managerAddress],
  });

  if (allowance >= fee) {
    return;
  }

  await approve(fee);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Could not create market.";
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
