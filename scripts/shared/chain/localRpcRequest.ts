import {
  JsonRpcTransportError,
  postJsonRpc,
  type JsonRpcResponse,
} from "./postJsonRpc.ts";
import { staleStackRecovery } from "./staleStackRecovery.ts";

/** A JSON-RPC envelope as a local devchain returns it: one of the two fields. */
export type RpcResponse = JsonRpcResponse;

/**
 * Sends one JSON-RPC call to a local devchain and returns its result, throwing
 * on a JSON-RPC error. `envFile` is required and names the env file that
 * claimed this chain, because every transport failure here is really an
 * env-file/chain mismatch and the recovery hint has to name the right file.
 */
export async function callLocalRpc(args: {
  readonly envFile: string;
  readonly method: string;
  readonly params: readonly unknown[];
  readonly rpcUrl: string;
}): Promise<unknown> {
  const response = await sendLocalRpcRequest(args);

  if (response.error) {
    throw new Error(
      `RPC ${args.method} failed on ${args.rpcUrl}: ${response.error.message}`,
    );
  }

  return response.result;
}

/**
 * The raw JSON-RPC envelope, for callers that treat a JSON-RPC error as data
 * rather than a failure (probing whether a contract responds at all). Transport
 * failures and non-2xx responses still throw — those are not answers.
 *
 * This is the local-devchain layer over `postJsonRpc`: it adds the one thing
 * that module withholds — what a developer should do when nothing answers —
 * which is only knowable here, where an env file claims a particular chain.
 */
export async function sendLocalRpcRequest({
  envFile,
  method,
  params,
  rpcUrl,
}: {
  readonly envFile: string;
  readonly method: string;
  readonly params: readonly unknown[];
  readonly rpcUrl: string;
}): Promise<RpcResponse> {
  try {
    return await postJsonRpc({ method, params, rpcUrl });
  } catch (error) {
    // Only an unreachable endpoint earns the recovery hint. A non-2xx means
    // something did answer, so stale-stack advice would misdirect.
    if (error instanceof JsonRpcTransportError) {
      throw new Error(
        `Cannot reach local RPC at ${rpcUrl}. ${staleStackRecovery({
          envFile,
          rpcUrl,
        })} (${error.message})`,
      );
    }

    throw error;
  }
}
