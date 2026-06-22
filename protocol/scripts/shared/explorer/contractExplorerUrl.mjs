/**
 * Formats a contract address URL for explorers that use an address route.
 */
export function contractExplorerUrl({ address, addressPath = "address", browserUrl }) {
  const baseUrl = browserUrl.replace(/\/$/, "");
  const route = addressPath.replace(/^\/|\/$/g, "");

  return `${baseUrl}/${route}/${address}`;
}
