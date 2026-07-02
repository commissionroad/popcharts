import type { Address } from "viem";

/**
 * Formats a contract address URL for explorers that use an address route.
 */
export function contractExplorerUrl({
  address,
  addressPath = "address",
  browserUrl,
}: {
  address: Address;
  addressPath?: string;
  browserUrl: string;
}): string {
  const baseUrl = browserUrl.replace(/\/$/, "");
  const route = addressPath.replace(/^\/|\/$/g, "");

  return `${baseUrl}/${route}/${address}`;
}
