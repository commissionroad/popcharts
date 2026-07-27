/**
 * Splits an RPC URL into the host and port strings a listener binds.
 *
 * `hardhat node` takes `--hostname`/`--port`, not a URL, so an orchestrator
 * that probes one URL but starts its node from the built-in defaults binds a
 * different chain than it validates against (ADR 0020). Deriving both ends
 * from the same URL is what keeps them honest.
 *
 * A URL with no explicit port reports its scheme's default rather than the
 * local chain port: naming 8545 there would describe a listener the URL never
 * did. Throws on a URL that cannot be parsed at all, because every caller uses
 * the result to bind or address a socket.
 */
export function parseRpcListenTarget(rpcUrl: string): {
  hostname: string;
  port: string;
} {
  let url: URL;

  try {
    url = new URL(rpcUrl);
  } catch {
    throw new Error(`Cannot read a host and port from RPC URL ${rpcUrl}.`);
  }

  return {
    hostname: url.hostname,
    port:
      url.port ||
      (url.protocol === "https:" || url.protocol === "wss:" ? "443" : "80"),
  };
}
