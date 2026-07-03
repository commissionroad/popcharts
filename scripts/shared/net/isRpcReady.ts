/**
 * True when a JSON-RPC endpoint answers `eth_chainId` with a result — enough
 * to prove a chain node is listening without requiring any deployed
 * artifacts. Returns false on any transport or protocol error.
 */
export async function isRpcReady(rpcUrl: string): Promise<boolean> {
  try {
    const response = await fetch(rpcUrl, {
      body: JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method: "eth_chainId",
        params: [],
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    });

    if (!response.ok) {
      return false;
    }

    const result = (await response.json()) as { result?: unknown };

    return Boolean(result.result);
  } catch {
    return false;
  }
}
