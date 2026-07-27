import { getErrorMessage } from "../errors/getErrorMessage.ts";

/** A JSON-RPC envelope as a chain node returns it: one of the two fields. */
export type JsonRpcResponse = {
  error?: { message: string };
  result?: unknown;
};

/**
 * Thrown when the endpoint could not be reached at all — DNS, connection
 * refused, a socket dropped mid-request. Distinct from a node that answered
 * with an error, because only this case means "nothing is listening there",
 * and callers that know who started the chain turn it into recovery advice.
 * Carries the underlying failure's own message so that advice can quote it.
 */
export class JsonRpcTransportError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "JsonRpcTransportError";
  }
}

/**
 * POSTs one JSON-RPC call and returns the raw envelope, leaving a JSON-RPC
 * `error` for the caller to interpret — probing a contract treats one as data,
 * not as a failure. An unreachable endpoint throws `JsonRpcTransportError` and
 * a non-2xx throws a plain `Error`: this module states what happened and never
 * what to do about it, since the right advice depends on who owns the chain.
 */
export async function postJsonRpc({
  method,
  params,
  rpcUrl,
}: {
  readonly method: string;
  readonly params: readonly unknown[];
  readonly rpcUrl: string;
}): Promise<JsonRpcResponse> {
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
    throw new JsonRpcTransportError(getErrorMessage(error), { cause: error });
  }

  if (!httpResponse.ok) {
    throw new Error(
      `RPC ${method} failed on ${rpcUrl}: HTTP ${httpResponse.status}.`,
    );
  }

  return (await httpResponse.json()) as JsonRpcResponse;
}
