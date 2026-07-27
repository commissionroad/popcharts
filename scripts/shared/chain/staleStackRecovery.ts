import { BASE_CHAIN_PORT } from "../localStack/ports.ts";

/**
 * The recovery instructions printed whenever a local chain answers but does not
 * match the env file the run loaded — the two are out of sync, and every such
 * failure has the same fix. Returns a sentence fragment meant to be appended to
 * the specific error that detected the mismatch.
 */
export function staleStackRecovery({
  envFile,
  rpcUrl,
}: {
  readonly envFile: string;
  readonly rpcUrl: string;
}): string {
  // The lsof hint names the port actually in play: hardcoding 8545 sent a
  // developer debugging a non-zero slot at the human stack's chain instead.
  const port = readRpcPort(rpcUrl);

  return (
    `${envFile} and the running RPC are probably out of sync. ` +
    `Stop the stale local node on ${rpcUrl}, then run ` +
    "'just local-dev-control' or 'just local-dev' from this checkout and " +
    "wait for contract deployment to complete. To find the process, run " +
    `'lsof -nP -iTCP:${port} -sTCP:LISTEN'.`
  );
}

/**
 * The TCP port `rpcUrl` addresses, for the recovery hint only. A URL with no
 * explicit port uses its scheme's default rather than the local chain port —
 * naming slot 0's 8545 there would point at a listener the URL never described.
 * Falls back to slot 0 only when the URL cannot be parsed at all, since this
 * builds a hint string and must never throw over the error it is explaining.
 */
export function readRpcPort(rpcUrl: string): string {
  try {
    const { port, protocol } = new URL(rpcUrl);
    return (
      port || (protocol === "https:" || protocol === "wss:" ? "443" : "80")
    );
  } catch {
    return String(BASE_CHAIN_PORT);
  }
}
