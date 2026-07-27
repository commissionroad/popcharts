import { pregradManagerAbi } from "@popcharts/protocol/pregrad-manager";
import { createPublicClient, http, isAddress } from "viem";

/**
 * Fails before any market is created unless `rpcUrl` is the local devchain the
 * caller believes it is: right chain id, contract code at the manager address,
 * and a `marketCount()` call that answers. A stale local env otherwise creates
 * markets against the wrong deployment and still reports success.
 *
 * `recoveryHint` is supplied by the caller and appended to every failure,
 * because what a developer should do about a mismatched chain depends on who
 * started it — this module knows the chain is wrong, not how to fix it.
 *
 * Reads through the generated `pregradManagerAbi`, so a rename of
 * `marketCount()` breaks the build here rather than at runtime as an
 * undecodable call (AGENTS.md: never hand-write first-party ABI fragments).
 */
export async function validateLocalPregradDeployment({
  expectedChainId,
  managerAddress,
  recoveryHint,
  rpcUrl,
}: {
  readonly expectedChainId: number;
  readonly managerAddress: string;
  readonly recoveryHint: string;
  readonly rpcUrl: string;
}): Promise<void> {
  if (!isAddress(managerAddress)) {
    throw new Error(
      `PREGRAD_MANAGER_ADDRESS=${managerAddress} is not an address. ` +
        recoveryHint,
    );
  }

  const client = createPublicClient({ transport: http(rpcUrl) });
  const chainId = await readChainId({ recoveryHint, rpcUrl, client });

  if (chainId !== expectedChainId) {
    throw new Error(
      `RPC_HTTP_URL=${rpcUrl} reported chain ID ${formatChainId(chainId)}, ` +
        `but local-create-market expects Hardhat localhost chain ` +
        `${expectedChainId}. ` +
        recoveryHint,
    );
  }

  const managerCode = await client.getCode({ address: managerAddress });

  if (!managerCode || managerCode === "0x") {
    throw new Error(
      `No contract code exists at PREGRAD_MANAGER_ADDRESS=${managerAddress} ` +
        `on ${rpcUrl}. ` +
        recoveryHint,
    );
  }

  try {
    await client.readContract({
      abi: pregradManagerAbi,
      address: managerAddress,
      functionName: "marketCount",
    });
  } catch (error) {
    throw new Error(
      `PREGRAD_MANAGER_ADDRESS=${managerAddress} on ${rpcUrl} does not ` +
        "look like the current local PregradManager deployment " +
        `(marketCount() failed: ${shortMessage(error)}). ` +
        recoveryHint,
    );
  }
}

async function readChainId({
  client,
  recoveryHint,
  rpcUrl,
}: {
  readonly client: ReturnType<typeof createPublicClient>;
  readonly recoveryHint: string;
  readonly rpcUrl: string;
}): Promise<number> {
  try {
    return await client.getChainId();
  } catch (error) {
    throw new Error(
      `Cannot reach local RPC at ${rpcUrl}. ${recoveryHint} ` +
        `(${shortMessage(error)})`,
    );
  }
}

// Renders a chain id the way a developer sees it in both places it appears:
// decimal in config, hex on the wire.
function formatChainId(chainId: number): string {
  return `${chainId} (0x${chainId.toString(16)})`;
}

// viem errors carry a multi-paragraph `message` (request body, docs link,
// version banner). `shortMessage` is the one-line summary; falling back to the
// full message keeps non-viem failures readable.
function shortMessage(error: unknown): string {
  if (error instanceof Error && "shortMessage" in error) {
    const short = (error as { shortMessage?: unknown }).shortMessage;
    if (typeof short === "string") {
      return short;
    }
  }

  return error instanceof Error ? error.message : "Unknown error.";
}
