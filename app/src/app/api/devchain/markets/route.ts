import { NextResponse } from "next/server";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseEventLogs,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { getPopChartsContractConfig } from "@/integrations/contracts/config";
import { pregradManagerAbi } from "@/integrations/contracts/pregrad-manager";
import { parseSerializedProtocolCreateMarketParams } from "@/integrations/contracts/protocol-params";
import { DisplayableError, presentError } from "@/lib/error-handling";
import { formatTokenAmount } from "@/lib/format";

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
      name:
        config.chainEnv === "arc-testnet"
          ? "Arc Testnet"
          : config.chainEnv === "local"
            ? "Hardhat Local"
            : "Pop Charts Devchain",
      nativeCurrency: config.nativeCurrency,
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
    const creationFee = await getMarketCreationFee({
      accountAddress: account.address,
      managerAddress: config.pregradManagerAddress,
      publicClient,
    });
    const hash = await walletClient.writeContract({
      abi: pregradManagerAbi,
      address: config.pregradManagerAddress,
      functionName: "createMarket",
      args: [params],
      value: creationFee,
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

async function getMarketCreationFee({
  accountAddress,
  managerAddress,
  publicClient,
}: {
  accountAddress: `0x${string}`;
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
    return 0n;
  }

  const balance = await publicClient.getBalance({
    address: accountAddress,
  });

  if (balance < fee) {
    throw new DisplayableError(
      `The devchain relay signer needs ${formatTokenAmount(
        fee
      )} native USDC to create this market. It has ${formatTokenAmount(
        balance
      )} available.`
    );
  }

  return fee;
}

function getErrorMessage(error: unknown) {
  // Log the raw failure server-side; return only well-formed copy to the client.
  return presentError(error, {
    context: { operation: "api/devchain/markets" },
    fallback: "Could not create market.",
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
