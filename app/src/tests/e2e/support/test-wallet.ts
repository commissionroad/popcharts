import type { Page } from "@playwright/test";

/**
 * Headless test wallet for devchain e2e runs.
 *
 * Playwright browsers have no wallet extension, so the app's local-wallet
 * mode (wagmi `injected()` connector) has nothing to connect to. This
 * fixture injects a minimal EIP-1193 provider that forwards every request
 * to the local Hardhat JSON-RPC node, which signs with its unlocked
 * accounts — no private keys ever reach the page. With it installed,
 * "Connect wallet" and every wallet-signed flow (receipts, claims, venue
 * orders, wallet-signer market creation) work headlessly.
 *
 * Installed via `page.addInitScript`, so it survives reloads and hard
 * navigations for the lifetime of the page.
 */

/** Hardhat mnemonic account #3 — reserved for e2e wallet flows so it never
 * races the deployer (#0), orchestrator accounts, or trading bots (#10–19)
 * on nonces. */
export const TEST_WALLET_ADDRESS = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";

/**
 * The header shows the account truncated (leading and trailing characters
 * around an ellipsis). Derived from the address once, here, so no spec can
 * drift from the account the provider actually reports.
 */
export const TEST_WALLET_ADDRESS_PATTERN = new RegExp(
  `${TEST_WALLET_ADDRESS.slice(0, 5)}.*${TEST_WALLET_ADDRESS.slice(-3)}`
);

/**
 * Where the provider forwards when the caller names no chain.
 *
 * The devchain e2e run exports the chain it resolved into the Playwright
 * process, so reading it keeps the browser's wallet on the same chain as the
 * deploys. A bare 8545 sends the wallet to slot 0 — the human's chain — from
 * any other slot, while the rest of the run uses its own (ADR 0020).
 */
function defaultRpcUrl(): string {
  return process.env.RPC_HTTP_URL || "http://127.0.0.1:8545";
}

export type InstallTestWalletOptions = {
  /** Account the provider reports for eth_accounts/eth_requestAccounts. */
  address?: string;
  /** Hardhat JSON-RPC endpoint that receives every forwarded request. */
  rpcUrl?: string;
};

/** Injects the forwarding EIP-1193 provider before any page script runs. */
export async function installTestWallet(
  page: Page,
  options: InstallTestWalletOptions = {}
): Promise<void> {
  const address = options.address ?? TEST_WALLET_ADDRESS;
  const rpcUrl = options.rpcUrl ?? defaultRpcUrl();

  await page.addInitScript(
    ({ address: account, rpcUrl: endpoint }) => {
      let nextId = 1;

      async function forward(method: string, params?: unknown[]) {
        const response = await fetch(endpoint, {
          body: JSON.stringify({
            id: nextId++,
            jsonrpc: "2.0",
            method,
            params: params ?? [],
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        });
        const body = (await response.json()) as {
          error?: { code?: number; message: string };
          result?: unknown;
        };
        // Rethrown for wagmi/viem to interpret (EIP-1193 shape), never
        // rendered — the rpcFailure name also keeps it out of the
        // no-raw-error-render guardrail's display-value patterns.
        const rpcFailure = body.error;
        if (rpcFailure) {
          const thrown = new Error(rpcFailure.message) as Error & {
            code?: number;
          };
          if (rpcFailure.code !== undefined) {
            thrown.code = rpcFailure.code;
          }
          throw thrown;
        }
        return body.result;
      }

      const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
      const provider = {
        // wagmi's injected() connector looks for a MetaMask-shaped provider.
        isMetaMask: true,
        isPopchartsTestWallet: true,
        on(event: string, listener: (...args: unknown[]) => void) {
          (listeners[event] ??= []).push(listener);
          return provider;
        },
        removeListener(event: string, listener: (...args: unknown[]) => void) {
          listeners[event] = (listeners[event] ?? []).filter(
            (candidate) => candidate !== listener
          );
          return provider;
        },
        async request({ method, params }: { method: string; params?: unknown[] }) {
          if (method === "eth_requestAccounts" || method === "eth_accounts") {
            return [account];
          }
          if (
            method === "wallet_switchEthereumChain" ||
            method === "wallet_addEthereumChain"
          ) {
            return null;
          }
          if (method === "wallet_requestPermissions") {
            return [{ parentCapability: "eth_accounts" }];
          }
          if (method === "eth_sendTransaction") {
            // Hardhat signs with its unlocked account; only ensure `from`.
            const [transaction] = (params ?? []) as [Record<string, unknown>?];
            return forward(method, [{ from: account, ...transaction }]);
          }
          return forward(method, params);
        },
      };

      (window as { ethereum?: unknown }).ethereum = provider;

      // EIP-6963 announcement so discovery-based connectors also find it.
      const info = Object.freeze({
        icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>",
        name: "Pop Charts Test Wallet",
        rdns: "dev.popcharts.testwallet",
        uuid: "00000000-4000-4000-8000-e2e7e57a11e7",
      });
      const announce = () =>
        window.dispatchEvent(
          new CustomEvent("eip6963:announceProvider", {
            detail: Object.freeze({ info, provider }),
          })
        );
      window.addEventListener("eip6963:requestProvider", announce);
      announce();
    },
    { address, rpcUrl }
  );
}

/**
 * Ensures the injected test wallet is connected, and returns once the header
 * shows its account.
 *
 * The connect button is transient: the provider answers `eth_accounts` with
 * the account unconditionally, so wagmi treats the site as already authorized
 * and reconnects on mount. A spec that waits for the button and then clicks it
 * is racing that reconnect — and losing the race looks like a 30s wait for a
 * button that is never coming back, *after* the app has reached exactly the
 * state the spec wanted. So the outcome is what's polled here, and a click
 * that misses its node is progress rather than an error.
 */
export async function connectTestWallet(page: Page): Promise<void> {
  const chip = page.getByText(TEST_WALLET_ADDRESS_PATTERN);
  const connect = page.getByRole("button", { name: "Connect wallet" });
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    if ((await chip.count()) > 0) {
      return;
    }
    await connect
      .first()
      .dispatchEvent("click", undefined, { timeout: 2_000 })
      .catch(() => {});
    await page.waitForTimeout(500);
  }

  throw new Error("The test wallet did not connect within 30s.");
}
