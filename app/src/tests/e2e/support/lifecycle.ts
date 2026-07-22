import { type Abi, createPublicClient, createWalletClient, http, parseAbi } from "viem";

import { completeSetBinaryMarketAbi } from "@/integrations/contracts/postgrad-venue";
import { pregradManagerAbi } from "@/integrations/contracts/pregrad-manager";

import { TEST_WALLET_ADDRESS } from "./test-wallet";

/**
 * Chain/API drivers for the `@lifecycle` specs. The orchestrator
 * (scripts/run-lifecycle-e2e.ts) boots the full local stack and passes its
 * coordinates through POPCHARTS_E2E_* env vars; these helpers walk a market
 * through approval, funding, graduation, and the terminal transitions so the
 * specs only exercise the user-visible surfaces through the browser.
 *
 * Writes sign via hardhat's unlocked accounts (json-rpc signing), the same
 * mechanism the injected test wallet uses — no private keys in the suite.
 */

/** Hardhat account #0: deployer, owner, review manager, and resolver on a
 * local deploy. */
export const OPERATOR_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

// MockCollateral is a local-only test mock with no generated ABI in
// @popcharts/protocol, so this minimal faucet surface is hand-written; the
// first-party child market below uses its generated ABI per AGENTS.md.
const mockCollateralAbi = parseAbi([
  "function mint(address account, uint256 amount) external",
  "function balanceOf(address account) view returns (uint256)",
]);

export type LifecycleEnv = {
  apiBaseUrl: string;
  chainId: number;
  collateralAddress: `0x${string}`;
  pregradManagerAddress: `0x${string}`;
  rpcUrl: string;
};

/** Reads the orchestrator-provided stack coordinates, failing loudly when a
 * spec runs outside `pnpm lifecycle:e2e`. */
export function lifecycleEnv(): LifecycleEnv {
  const read = (name: string): string => {
    const value = process.env[name];
    if (!value) {
      throw new Error(
        `${name} is not set — run the lifecycle suite via 'pnpm lifecycle:e2e'.`
      );
    }
    return value;
  };

  return {
    apiBaseUrl: read("POPCHARTS_E2E_API_BASE_URL"),
    chainId: Number.parseInt(read("POPCHARTS_E2E_CHAIN_ID"), 10),
    collateralAddress: read("POPCHARTS_E2E_COLLATERAL_ADDRESS") as `0x${string}`,
    pregradManagerAddress: read(
      "POPCHARTS_E2E_PREGRAD_MANAGER_ADDRESS"
    ) as `0x${string}`,
    rpcUrl: read("POPCHARTS_E2E_RPC_URL"),
  };
}

function publicClient(env: LifecycleEnv) {
  return createPublicClient({ transport: http(env.rpcUrl) });
}

/** A wallet client whose writes hardhat signs with its unlocked account. */
function operatorClient(env: LifecycleEnv) {
  return createWalletClient({
    account: OPERATOR_ADDRESS as `0x${string}`,
    transport: http(env.rpcUrl),
  });
}

async function writeAsOperator(
  env: LifecycleEnv,
  request: {
    abi: Abi;
    address: `0x${string}`;
    args?: readonly unknown[];
    functionName: string;
  }
) {
  const hash = await operatorClient(env).writeContract({
    ...request,
    account: OPERATOR_ADDRESS as `0x${string}`,
    chain: null,
  });
  await publicClient(env).waitForTransactionReceipt({ hash });
}

/** approveMarket as the local review manager, moving under_review →
 * bootstrap on-chain; the indexer projects the status change. */
export async function approveMarket(env: LifecycleEnv, marketId: bigint) {
  await writeAsOperator(env, {
    abi: pregradManagerAbi as Abi,
    address: env.pregradManagerAddress,
    args: [marketId],
    functionName: "approveMarket",
  });
}

/** Faucet-mints local mock collateral so the test wallet can fund receipts. */
export async function mintCollateral(env: LifecycleEnv, amountWad: bigint) {
  await writeAsOperator(env, {
    abi: mockCollateralAbi as Abi,
    address: env.collateralAddress,
    args: [TEST_WALLET_ADDRESS as `0x${string}`, amountWad],
    functionName: "mint",
  });
}

/** The resolver-keyed postgrad draw: cancel() on the child market. */
export async function cancelPostgradMarket(
  env: LifecycleEnv,
  marketAddress: `0x${string}`
) {
  await writeAsOperator(env, {
    abi: completeSetBinaryMarketAbi as Abi,
    address: marketAddress,
    args: [],
    functionName: "cancel",
  });
}

export async function collateralBalance(
  env: LifecycleEnv,
  account: `0x${string}`
): Promise<bigint> {
  return publicClient(env).readContract({
    abi: mockCollateralAbi,
    address: env.collateralAddress,
    args: [account],
    functionName: "balanceOf",
  });
}

async function devEndpoint(
  env: LifecycleEnv,
  marketId: bigint,
  path: string
): Promise<void> {
  const url = `${env.apiBaseUrl}/dev/markets/${env.chainId}/${marketId}${path}`;
  const response = await fetch(url, { method: "POST" });
  if (!response.ok) {
    throw new Error(
      `POST ${url} failed (${response.status}): ${await response.text()}`
    );
  }
}

/** Dev graduation with force: mints dev collateral and places receipts to
 * cover the graduation threshold, runs real band-pass clearing, and claims
 * every receipt — receipt owners end up holding outcome tokens. */
export async function graduateMarket(env: LifecycleEnv, marketId: bigint) {
  await devEndpoint(env, marketId, "/graduate?force=true");
}

/**
 * Forces a review verdict deterministically through the dev review endpoint:
 * it writes a review record with the given reasons and submits the matching
 * on-chain approve/reject. This is how the UI journeys set the review outcome —
 * review is a controlled test input here, not a dependency on the AI runner.
 */
export async function forceReview(
  env: LifecycleEnv,
  marketId: bigint,
  verdict: "approve" | "reject" | "manual_review",
  reasons?: string[]
): Promise<void> {
  const url = `${env.apiBaseUrl}/dev/markets/${env.chainId}/${marketId}/review`;
  const response = await fetch(url, {
    body: JSON.stringify(reasons ? { reasons, verdict } : { verdict }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(
      `POST ${url} failed (${response.status}): ${await response.text()}`
    );
  }
}

/** Dev resolution: jumps chain time past the resolution gate and resolves. */
export async function resolveMarket(
  env: LifecycleEnv,
  marketId: bigint,
  side: "yes" | "no"
) {
  await devEndpoint(env, marketId, `/resolve/${side}`);
}

type ApiMarket = {
  postgrad?: { marketAddress: string };
  resolution?: { kind: string; winningSide?: string };
  status: string;
};

/**
 * Polls the API until the indexer has projected the expected status (and any
 * extra `until` condition — e.g. the terminal resolution row, which a
 * dev-resolve's direct status write can briefly race ahead of).
 */
export async function waitForMarketStatus(
  env: LifecycleEnv,
  marketId: bigint,
  status: string,
  options: {
    timeoutMs?: number;
    until?: (market: ApiMarket) => boolean;
  } = {}
): Promise<ApiMarket> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const deadline = Date.now() + timeoutMs;
  let last = "";

  while (Date.now() < deadline) {
    const response = await fetch(
      `${env.apiBaseUrl}/markets/${env.chainId}/${marketId}`
    );
    if (response.ok) {
      const market = (await response.json()) as ApiMarket;
      last = market.status;
      if (market.status === status && (options.until?.(market) ?? true)) {
        return market;
      }
    }
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 1_000));
  }

  throw new Error(
    `Market ${marketId} did not reach status '${status}' within ${timeoutMs}ms (last: '${last}').`
  );
}

/**
 * Current local chain time in epoch milliseconds. Deadline fields must be
 * derived from this, not wall clock: dev resolution jumps the chain days
 * ahead, so the next market's wall-clock deadlines would be in the chain's
 * past and creation would revert.
 */
export async function chainNowMs(env: LifecycleEnv): Promise<number> {
  const block = await publicClient(env).getBlock();

  return Number(block.timestamp) * 1000;
}

/** The app route for a market, mirroring buildApiMarketAppId. */
export function marketPath(env: LifecycleEnv, marketId: bigint): string {
  return `/markets/${env.chainId}:${marketId}`;
}
