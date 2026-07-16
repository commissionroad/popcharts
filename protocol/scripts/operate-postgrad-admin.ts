import { relative, resolve } from "node:path";

import { erc20Abi, formatUnits, getAddress, type Address, type Hex, type PublicClient } from "viem";

import { parseDecimalTokenAmount } from "./shared/cli/parseDecimalTokenAmount.js";
import { collectVenueAddressEntries } from "./shared/deployment/venueManifest.js";
import { readJsonFile } from "./shared/json/jsonFile.js";
import { COMPLETE_SET_MARKET_STATUS } from "./shared/market/completeSetMarketStatus.js";
import {
  readCompleteSetMarketManifest,
  type CompleteSetMarketManifestData,
} from "./shared/market/readCompleteSetMarketManifest.js";
import { requireSuccessfulReceipt } from "./shared/viem/requireSuccessfulReceipt.js";
import { pregradManagerAbi } from "../src/generated/pregrad-manager.js";
import {
  boundedPoolOrderManagerAbi,
  completeSetBinaryMarketAbi,
} from "../src/generated/postgrad-venue.js";
import { marketSideToContractSide } from "../src/market-side.js";

/** One owner/resolver workflow the postgrad admin CLI can plan and broadcast. */
export type PostgradAdminAction =
  | { readonly account: Address; readonly allowed: boolean; readonly kind: "setHookRole" }
  | { readonly account: Address; readonly allowed: boolean; readonly kind: "setResolverRole" }
  | { readonly account: Address; readonly kind: "setTrustedCreator"; readonly trusted: boolean }
  | { readonly amount: string; readonly kind: "setMinimumOrderAmount"; readonly token: Address }
  | {
      readonly amount: string;
      readonly kind: "setMinimumOrderAmount";
      readonly side: "no" | "yes";
    }
  | { readonly count: bigint; readonly kind: "setMaximumExecutionCount" }
  | { readonly kind: "cancelMarket" }
  | { readonly kind: "resolveMarket"; readonly side: "no" | "yes" }
  | { readonly kind: "setMarketCreationPaused"; readonly paused: boolean }
  | {
      readonly kind: "setPoolWhitelisted";
      readonly side: "no" | "yes";
      readonly whitelisted: boolean;
    };

/** Chain access and manifest-resolution context for one admin action run. */
export type PostgradAdminContext = {
  readonly callerAddress: Address;
  readonly chainEnv: string;
  readonly chainId: number;
  readonly env: NodeJS.ProcessEnv;
  /** Broadcast only when true; the default is a read-only dry run. */
  readonly execute: boolean;
  readonly protocolRoot: string;
  readonly publicClient: PublicClient;
  readonly walletClient: AdminContractWriter;
};

type AdminContractWriter = {
  writeContract(parameters: {
    abi: readonly unknown[];
    address: Address;
    args: readonly unknown[];
    functionName: string;
  }): Promise<Hex>;
};

// One planned state change: read-back current state, the proposed value, the
// authority that may apply it, and the write/verify pair used with --execute.
type PlannedChange = {
  readonly currentDescription: string;
  readonly label: string;
  readonly noOp: boolean;
  readonly proposedDescription: string;
  readonly requiredRole: { readonly holder: Address; readonly name: string };
  readonly verify: () => Promise<void>;
  readonly write: () => Promise<Hex>;
};

/**
 * Plans and (with `execute`) broadcasts one owner/resolver admin action for
 * the postgrad venue: order-manager role and parameter management, market
 * resolution/cancellation, and pregrad creation controls. Every run prints
 * the current on-chain state and the proposed change, refuses no-op changes,
 * and fails before broadcast when the caller lacks the required role
 * (naming that role). Dry-run is the default posture per ADR 0009's
 * operational-monitoring stance for the unaudited testnet venue.
 */
export async function runPostgradAdminAction(
  context: PostgradAdminContext,
  action: PostgradAdminAction,
): Promise<void> {
  const change = await planChange(context, action);

  console.log(`Action: ${change.label}`);
  console.log(`Caller: ${context.callerAddress}`);
  console.log(`Current state: ${change.currentDescription}`);
  console.log(`Proposed change: ${change.proposedDescription}`);

  if (change.noOp) {
    throw new Error(
      `Refusing no-op change: the proposed state already matches the current on-chain state ` +
        `(${change.currentDescription}).`,
    );
  }
  if (context.callerAddress !== change.requiredRole.holder) {
    throw new Error(
      `Caller ${context.callerAddress} does not hold the required ${change.requiredRole.name} ` +
        `role (held by ${change.requiredRole.holder}); the transaction would revert.`,
    );
  }

  if (!context.execute) {
    console.log("[dry-run] No transaction broadcast. Re-run with --execute to apply this change.");
    return;
  }

  const hash = await change.write();
  await requireSuccessfulReceipt(context.publicClient, hash, change.label);
  await change.verify();
  console.log(`Executed ${change.label} (${hash}); on-chain state verified.`);
}

async function planChange(
  context: PostgradAdminContext,
  action: PostgradAdminAction,
): Promise<PlannedChange> {
  switch (action.kind) {
    case "cancelMarket":
      return planMarketLifecycle(context, { kind: "cancel" });
    case "resolveMarket":
      return planMarketLifecycle(context, { kind: "resolve", side: action.side });
    case "setHookRole":
      return planOrderManagerFlag(context, {
        account: action.account,
        desired: action.allowed,
        readFunction: "hookRole",
        writeFunction: "setHookRole",
      });
    case "setMarketCreationPaused":
      return planPregradPause(context, action.paused);
    case "setMaximumExecutionCount":
      return planMaximumExecutionCount(context, action.count);
    case "setMinimumOrderAmount":
      return planMinimumOrderAmount(context, action);
    case "setPoolWhitelisted":
      return planPoolWhitelisted(context, action.side, action.whitelisted);
    case "setResolverRole":
      return planOrderManagerFlag(context, {
        account: action.account,
        desired: action.allowed,
        readFunction: "resolverRole",
        writeFunction: "setResolverRole",
      });
    case "setTrustedCreator":
      return planTrustedCreator(context, action.account, action.trusted);
  }
}

async function planOrderManagerFlag(
  context: PostgradAdminContext,
  args: {
    account: Address;
    desired: boolean;
    readFunction: "hookRole" | "resolverRole";
    writeFunction: "setHookRole" | "setResolverRole";
  },
): Promise<PlannedChange> {
  const orderManager = await resolveOrderManagerAddress(context);
  const owner = await readOrderManagerOwner(context, orderManager);
  const current = await context.publicClient.readContract({
    abi: boundedPoolOrderManagerAbi,
    address: orderManager,
    args: [args.account],
    functionName: args.readFunction,
  });

  return {
    currentDescription: `${args.readFunction}(${args.account}) = ${current}`,
    label: `${args.writeFunction} on BoundedPoolOrderManager ${orderManager}`,
    noOp: current === args.desired,
    proposedDescription: `${args.readFunction}(${args.account}) = ${args.desired}`,
    requiredRole: { holder: owner, name: "BoundedPoolOrderManager owner" },
    verify: async () => {
      const after = await context.publicClient.readContract({
        abi: boundedPoolOrderManagerAbi,
        address: orderManager,
        args: [args.account],
        functionName: args.readFunction,
      });
      if (after !== args.desired) {
        throw new Error(`${args.writeFunction} read back ${after}, expected ${args.desired}.`);
      }
    },
    write: () =>
      context.walletClient.writeContract({
        abi: boundedPoolOrderManagerAbi,
        address: orderManager,
        args: [args.account, args.desired],
        functionName: args.writeFunction,
      }),
  };
}

async function planPoolWhitelisted(
  context: PostgradAdminContext,
  side: "no" | "yes",
  whitelisted: boolean,
): Promise<PlannedChange> {
  const manifest = await readMarketManifest(context);
  const pool = manifest.pools[side];
  const orderManager = manifest.venue.orderManager;
  const owner = await readOrderManagerOwner(context, orderManager);
  const current = await context.publicClient.readContract({
    abi: boundedPoolOrderManagerAbi,
    address: orderManager,
    args: [pool.poolId],
    functionName: "poolWhitelisted",
  });

  return {
    currentDescription: `poolWhitelisted(${side.toUpperCase()} pool ${pool.poolId}) = ${current}`,
    label: `setPoolWhitelisted on BoundedPoolOrderManager ${orderManager}`,
    noOp: current === whitelisted,
    proposedDescription: `poolWhitelisted(${side.toUpperCase()} pool) = ${whitelisted}`,
    requiredRole: { holder: owner, name: "BoundedPoolOrderManager owner" },
    verify: async () => {
      const after = await context.publicClient.readContract({
        abi: boundedPoolOrderManagerAbi,
        address: orderManager,
        args: [pool.poolId],
        functionName: "poolWhitelisted",
      });
      if (after !== whitelisted) {
        throw new Error(`setPoolWhitelisted read back ${after}, expected ${whitelisted}.`);
      }
    },
    write: () =>
      context.walletClient.writeContract({
        abi: boundedPoolOrderManagerAbi,
        address: orderManager,
        args: [pool.poolKey, whitelisted],
        functionName: "setPoolWhitelisted",
      }),
  };
}

async function planMaximumExecutionCount(
  context: PostgradAdminContext,
  count: bigint,
): Promise<PlannedChange> {
  if (count <= 0n) {
    throw new Error(`Expected --count to be a positive integer, received ${count}.`);
  }
  const orderManager = await resolveOrderManagerAddress(context);
  const owner = await readOrderManagerOwner(context, orderManager);
  const current = await context.publicClient.readContract({
    abi: boundedPoolOrderManagerAbi,
    address: orderManager,
    functionName: "maximumExecutionCount",
  });

  return {
    currentDescription: `maximumExecutionCount = ${current}`,
    label: `setMaximumExecutionCount on BoundedPoolOrderManager ${orderManager}`,
    noOp: current === count,
    proposedDescription: `maximumExecutionCount = ${count}`,
    requiredRole: { holder: owner, name: "BoundedPoolOrderManager owner" },
    verify: async () => {
      const after = await context.publicClient.readContract({
        abi: boundedPoolOrderManagerAbi,
        address: orderManager,
        functionName: "maximumExecutionCount",
      });
      if (after !== count) {
        throw new Error(`setMaximumExecutionCount read back ${after}, expected ${count}.`);
      }
    },
    write: () =>
      context.walletClient.writeContract({
        abi: boundedPoolOrderManagerAbi,
        address: orderManager,
        args: [count],
        functionName: "setMaximumExecutionCount",
      }),
  };
}

async function planMinimumOrderAmount(
  context: PostgradAdminContext,
  action: Extract<PostgradAdminAction, { kind: "setMinimumOrderAmount" }>,
): Promise<PlannedChange> {
  let token: Address;
  let orderManager: Address;
  if ("token" in action) {
    token = action.token;
    orderManager = await resolveOrderManagerAddress(context);
  } else {
    const manifest = await readMarketManifest(context);
    token = manifest.pools[action.side].outcomeToken;
    orderManager = manifest.venue.orderManager;
  }
  const decimals = await context.publicClient.readContract({
    abi: erc20Abi,
    address: token,
    functionName: "decimals",
  });
  const amount = parseDecimalTokenAmount(action.amount, {
    allowZero: true,
    decimals,
    label: "--amount",
  });
  const owner = await readOrderManagerOwner(context, orderManager);
  const current = await context.publicClient.readContract({
    abi: boundedPoolOrderManagerAbi,
    address: orderManager,
    args: [token],
    functionName: "minimumOrderAmount",
  });

  return {
    currentDescription:
      `minimumOrderAmount(${token}) = ${current} raw ` +
      `(${formatUnits(current, decimals)} tokens)`,
    label: `setMinimumOrderAmount on BoundedPoolOrderManager ${orderManager}`,
    noOp: current === amount,
    proposedDescription: `minimumOrderAmount(${token}) = ${amount} raw (${formatUnits(amount, decimals)} tokens)`,
    requiredRole: { holder: owner, name: "BoundedPoolOrderManager owner" },
    verify: async () => {
      const after = await context.publicClient.readContract({
        abi: boundedPoolOrderManagerAbi,
        address: orderManager,
        args: [token],
        functionName: "minimumOrderAmount",
      });
      if (after !== amount) {
        throw new Error(`setMinimumOrderAmount read back ${after}, expected ${amount}.`);
      }
    },
    write: () =>
      context.walletClient.writeContract({
        abi: boundedPoolOrderManagerAbi,
        address: orderManager,
        args: [token, amount],
        functionName: "setMinimumOrderAmount",
      }),
  };
}

async function planMarketLifecycle(
  context: PostgradAdminContext,
  request: { kind: "cancel" } | { kind: "resolve"; side: "no" | "yes" },
): Promise<PlannedChange> {
  const manifest = await readMarketManifest(context);
  const market = manifest.market.address;
  const resolver = getAddress(
    await context.publicClient.readContract({
      abi: completeSetBinaryMarketAbi,
      address: market,
      functionName: "resolver",
    }),
  );
  const status = Number(
    await context.publicClient.readContract({
      abi: completeSetBinaryMarketAbi,
      address: market,
      functionName: "status",
    }),
  );
  if (status !== COMPLETE_SET_MARKET_STATUS.trading) {
    throw new Error(
      `Market ${market} has status ${status}; only a Trading market can be ` +
        `${request.kind === "resolve" ? "resolved" : "cancelled"}.`,
    );
  }

  const expectedStatus =
    request.kind === "resolve"
      ? COMPLETE_SET_MARKET_STATUS.resolved
      : COMPLETE_SET_MARKET_STATUS.cancelled;
  const proposed =
    request.kind === "resolve"
      ? `resolve(${request.side.toUpperCase()}) -> status Resolved`
      : "cancel() -> status Cancelled (draw redemption at half value)";
  return {
    currentDescription: `status = Trading (0), resolver = ${resolver}`,
    label:
      request.kind === "resolve"
        ? `resolve on CompleteSetBinaryMarket ${market}`
        : `cancel on CompleteSetBinaryMarket ${market}`,
    noOp: false,
    proposedDescription: proposed,
    requiredRole: { holder: resolver, name: "CompleteSetBinaryMarket resolver" },
    verify: async () => {
      const after = Number(
        await context.publicClient.readContract({
          abi: completeSetBinaryMarketAbi,
          address: market,
          functionName: "status",
        }),
      );
      if (after !== expectedStatus) {
        throw new Error(`Market status read back ${after}, expected ${expectedStatus}.`);
      }
    },
    write: () =>
      request.kind === "resolve"
        ? context.walletClient.writeContract({
            abi: completeSetBinaryMarketAbi,
            address: market,
            args: [marketSideToContractSide(request.side)],
            functionName: "resolve",
          })
        : context.walletClient.writeContract({
            abi: completeSetBinaryMarketAbi,
            address: market,
            args: [],
            functionName: "cancel",
          }),
  };
}

async function planTrustedCreator(
  context: PostgradAdminContext,
  account: Address,
  trusted: boolean,
): Promise<PlannedChange> {
  const pregradManager = await resolvePostgradManifestAddress(context, "pregradManager");
  const owner = await readPregradOwner(context, pregradManager);
  const current = await context.publicClient.readContract({
    abi: pregradManagerAbi,
    address: pregradManager,
    args: [account],
    functionName: "isTrustedCreator",
  });

  return {
    currentDescription: `isTrustedCreator(${account}) = ${current}`,
    label: `setTrustedCreator on PregradManager ${pregradManager}`,
    noOp: current === trusted,
    proposedDescription: `isTrustedCreator(${account}) = ${trusted}`,
    requiredRole: { holder: owner, name: "PregradManager owner" },
    verify: async () => {
      const after = await context.publicClient.readContract({
        abi: pregradManagerAbi,
        address: pregradManager,
        args: [account],
        functionName: "isTrustedCreator",
      });
      if (after !== trusted) {
        throw new Error(`setTrustedCreator read back ${after}, expected ${trusted}.`);
      }
    },
    write: () =>
      context.walletClient.writeContract({
        abi: pregradManagerAbi,
        address: pregradManager,
        args: [account, trusted],
        functionName: "setTrustedCreator",
      }),
  };
}

async function planPregradPause(
  context: PostgradAdminContext,
  paused: boolean,
): Promise<PlannedChange> {
  const pregradManager = await resolvePostgradManifestAddress(context, "pregradManager");
  const owner = await readPregradOwner(context, pregradManager);
  const current = await context.publicClient.readContract({
    abi: pregradManagerAbi,
    address: pregradManager,
    functionName: "marketCreationPaused",
  });

  return {
    currentDescription: `marketCreationPaused = ${current}`,
    label: `setMarketCreationPaused on PregradManager ${pregradManager}`,
    noOp: current === paused,
    proposedDescription: `marketCreationPaused = ${paused}`,
    requiredRole: { holder: owner, name: "PregradManager owner" },
    verify: async () => {
      const after = await context.publicClient.readContract({
        abi: pregradManagerAbi,
        address: pregradManager,
        functionName: "marketCreationPaused",
      });
      if (after !== paused) {
        throw new Error(`setMarketCreationPaused read back ${after}, expected ${paused}.`);
      }
    },
    write: () =>
      context.walletClient.writeContract({
        abi: pregradManagerAbi,
        address: pregradManager,
        args: [paused],
        functionName: "setMarketCreationPaused",
      }),
  };
}

async function readOrderManagerOwner(
  context: PostgradAdminContext,
  orderManager: Address,
): Promise<Address> {
  return getAddress(
    await context.publicClient.readContract({
      abi: boundedPoolOrderManagerAbi,
      address: orderManager,
      functionName: "owner",
    }),
  );
}

async function readPregradOwner(
  context: PostgradAdminContext,
  pregradManager: Address,
): Promise<Address> {
  return getAddress(
    await context.publicClient.readContract({
      abi: pregradManagerAbi,
      address: pregradManager,
      functionName: "owner",
    }),
  );
}

async function readMarketManifest(
  context: PostgradAdminContext,
): Promise<CompleteSetMarketManifestData> {
  const { manifest } = await readCompleteSetMarketManifest({
    chainEnv: context.chainEnv,
    env: context.env,
    expectedChainId: context.chainId,
    protocolRoot: context.protocolRoot,
  });
  return manifest;
}

// Venue-level targets come from the postgrad manifest so the CLI works even
// before any market manifest exists.
async function resolveOrderManagerAddress(context: PostgradAdminContext): Promise<Address> {
  return resolvePostgradManifestAddress(context, "orderManager");
}

async function resolvePostgradManifestAddress(
  context: PostgradAdminContext,
  name: string,
): Promise<Address> {
  const manifestFile = resolve(
    context.protocolRoot,
    context.env.POPCHARTS_POSTGRAD_DEPLOYMENT_FILE ||
      `deployments/${context.chainEnv}.postgrad.local.json`,
  );
  const manifestPath = relative(context.protocolRoot, manifestFile);
  let manifest: unknown;
  try {
    manifest = await readJsonFile(manifestFile);
  } catch {
    throw new Error(
      `Could not read postgrad manifest ${manifestPath}. Run the postgrad deploy first ` +
        "(pnpm local:deploy-postgrad or pnpm arc:testnet:deploy-postgrad).",
    );
  }
  const manifestChainId =
    typeof manifest === "object" && manifest !== null && !Array.isArray(manifest)
      ? (manifest as Record<string, unknown>).chainId
      : undefined;
  if (manifestChainId !== context.chainId) {
    throw new Error(
      `Postgrad manifest ${manifestPath} is for chain ${String(manifestChainId)}, ` +
        `but the connected chain is ${context.chainId}.`,
    );
  }
  const entry = collectVenueAddressEntries(manifest).find((candidate) => candidate.name === name);
  if (entry === undefined) {
    throw new Error(`Postgrad manifest ${manifestPath} has no ${name} address entry.`);
  }
  return entry.address;
}
