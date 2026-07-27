import { BASE_CHAIN_ID } from "../localStack/ports.ts";
import { callLocalRpc, sendLocalRpcRequest } from "./localRpcRequest.ts";
import {
  MARKET_COUNT_SELECTOR,
  formatChainId,
  isUint256Word,
} from "./pregradManagerProbe.ts";
import { staleStackRecovery } from "./staleStackRecovery.ts";

// eth_chainId answers in hex, so the comparison happens in hex; derived from
// the one chain-id constant rather than restating 0x7a69 next to it.
const localChainIdHex = `0x${BASE_CHAIN_ID.toString(16)}`;

/**
 * Fails before any market is created unless `rpcUrl` is the local devchain the
 * loaded env file describes: right chain id, contract code at the manager
 * address, and a `marketCount()` call that decodes. A stale env file otherwise
 * creates the market against the wrong deployment and still reports success,
 * so every failure here carries the stale-stack recovery instructions.
 */
export async function validateLocalPregradDeployment({
  env,
  envFile,
  rpcUrl,
}: {
  readonly env: NodeJS.ProcessEnv;
  readonly envFile: string;
  readonly rpcUrl: string;
}): Promise<void> {
  const managerAddress = env.PREGRAD_MANAGER_ADDRESS;
  const chainId = await callLocalRpc({
    envFile,
    method: "eth_chainId",
    params: [],
    rpcUrl,
  });

  if (chainId !== localChainIdHex) {
    throw new Error(
      `RPC_HTTP_URL=${rpcUrl} reported chain ID ${formatChainId(
        chainId,
      )}, but local-create-market expects Hardhat localhost chain ` +
        `${BASE_CHAIN_ID}. ` +
        staleStackRecovery({ envFile, rpcUrl }),
    );
  }

  const managerCode = await callLocalRpc({
    envFile,
    method: "eth_getCode",
    params: [managerAddress, "latest"],
    rpcUrl,
  });

  if (!managerCode || managerCode === "0x") {
    throw new Error(
      `No contract code exists at PREGRAD_MANAGER_ADDRESS=${managerAddress} ` +
        `on ${rpcUrl}. ` +
        staleStackRecovery({ envFile, rpcUrl }),
    );
  }

  const probe = await sendLocalRpcRequest({
    envFile,
    method: "eth_call",
    params: [
      {
        data: MARKET_COUNT_SELECTOR,
        to: managerAddress,
      },
      "latest",
    ],
    rpcUrl,
  });

  if (probe.error) {
    throw new Error(
      `PREGRAD_MANAGER_ADDRESS=${managerAddress} on ${rpcUrl} does not ` +
        "look like the current local PregradManager deployment " +
        `(marketCount() failed: ${probe.error.message}). ` +
        staleStackRecovery({ envFile, rpcUrl }),
    );
  }

  if (!isUint256Word(probe.result)) {
    throw new Error(
      `PREGRAD_MANAGER_ADDRESS=${managerAddress} on ${rpcUrl} returned an ` +
        `unexpected marketCount() value (${probe.result}). ` +
        staleStackRecovery({ envFile, rpcUrl }),
    );
  }
}
