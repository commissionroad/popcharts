import { getErrorMessage } from "../errors/getErrorMessage.ts";
import { staleStackRecovery } from "./staleStackRecovery.ts";

/** A JSON-RPC envelope as a local devchain returns it: one of the two fields. */
export type RpcResponse = {
  error?: { message: string };
  result?: unknown;
};

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
  let httpResponse: Response;

  try {
    httpResponse = await fetch(rpcUrl, {
      body: JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method,
        params,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
  } catch (error) {
    throw new Error(
      `Cannot reach local RPC at ${rpcUrl}. ${staleStackRecovery({
        envFile,
        rpcUrl,
      })} (${getErrorMessage(error)})`,
    );
  }

  if (!httpResponse.ok) {
    throw new Error(
      `RPC ${method} failed on ${rpcUrl}: HTTP ${httpResponse.status}.`,
    );
  }

  return (await httpResponse.json()) as RpcResponse;
}
