import { postJsonRpc } from "../chain/postJsonRpc.ts";

/**
 * True when a JSON-RPC endpoint answers `eth_chainId` with a result — enough
 * to prove a chain node is listening without requiring any deployed
 * artifacts. Returns false on any transport or protocol error.
 */
export async function isRpcReady(rpcUrl: string): Promise<boolean> {
  try {
    const response = await postJsonRpc({
      method: "eth_chainId",
      params: [],
      rpcUrl,
    });

    return Boolean(response.result);
  } catch {
    return false;
  }
}
