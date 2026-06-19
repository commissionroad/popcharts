/**
 * Formats a contract address URL for explorers that use an address route.
 */
export function contractExplorerUrl({ address, addressPath = "address", browserUrl }) {
  return `${browserUrl}/${addressPath}/${address}`;
}
