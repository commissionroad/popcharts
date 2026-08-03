import { privateKeyToAccount } from "viem/accounts";

import { reviewBondVaultAbi } from "@popcharts/protocol";

import {
  createReadOnlyClient,
  createWalletClient,
} from "src/blockchain/client";
import { config, ZERO_ADDRESS } from "src/config";
import { and, db, eq, isNull, schema, sql } from "src/db/client";
import type { MarketDraftRow } from "src/db/schema/market-drafts";

/**
 * The review-bond price list (ADR 0022 §3), in the vault's native units with
 * the inherited `$1 = 1e18` peg (protocol ADR 0009 Q1). A draft's first
 * submission costs $1 and bundles its first five review runs; runs beyond
 * the bundle cost $0.20 each. A creator must hold the $5 standing bond
 * before submitting at all — that floor, not the per-use fees, is what makes
 * a fresh free wallet unable to spend provider money.
 */
export const REVIEW_BOND_PRICING = {
  extraReviewChargeWad: 2n * 10n ** 17n,
  includedReviewRuns: 5,
  minimumStandingBondWad: 5n * 10n ** 18n,
  submissionChargeWad: 10n ** 18n,
} as const;

/** When a creator's unsettled meter reaches this, settlement is due. */
const SETTLE_THRESHOLD_WAD = REVIEW_BOND_PRICING.submissionChargeWad;

/** The default local resolver: hardhat account #0, the vault's deployer. */
const DEFAULT_LOCAL_RESOLVER_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

export type BondChargeQuote =
  | { kind: "not_metered" }
  | { kind: "missing_wallet" }
  | {
      amountWad: bigint;
      chargeKind: "extra_review" | "submission" | null;
      kind: "chargeable";
    }
  | {
      availableWad: bigint;
      kind: "insufficient";
      minimumStandingBondWad: bigint;
      requiredWad: bigint;
      standingBondWad: bigint;
    }
  | { kind: "unavailable" };

export type BondMeterDependencies = {
  readBond: (
    address: `0x${string}`,
  ) => Promise<{ availableWad: bigint; depositedWad: bigint }>;
  vaultAddress: () => `0x${string}`;
};

const defaultDependencies: BondMeterDependencies = {
  readBond: async (address) => {
    const client = createReadOnlyClient();
    const vault = config.contracts.reviewBondVault;
    const [availableWad, depositedWad] = await Promise.all([
      client.readContract({
        abi: reviewBondVaultAbi,
        address: vault,
        functionName: "availableBond",
        args: [address],
      }),
      client.readContract({
        abi: reviewBondVaultAbi,
        address: vault,
        functionName: "depositedOf",
        args: [address],
      }),
    ]);

    return { availableWad, depositedWad };
  },
  vaultAddress: () => config.contracts.reviewBondVault,
};

/**
 * Prices one review run of a draft and checks the creator's bond covers it
 * (ADR 0022 §3). The meter is active whenever a vault address is configured;
 * without one (a local stack booted before the vault deploy, tests) drafts
 * submit unmetered. Chain-read failures fail CLOSED — this is a money gate,
 * so "the bond service is unavailable" refuses the submission rather than
 * giving the review away.
 *
 * The bonded balance is discounted by the creator's UNSETTLED meter charges:
 * the vault only learns about consumption at settlement, so the meter must
 * not let a creator spend the same bonded dollar twice between settlements.
 */
export async function quoteSubmissionCharge(
  {
    draft,
    priorReviewRuns,
  }: {
    draft: MarketDraftRow;
    priorReviewRuns: number;
  },
  dependencies: BondMeterDependencies = defaultDependencies,
): Promise<BondChargeQuote> {
  if (dependencies.vaultAddress() === ZERO_ADDRESS) {
    return { kind: "not_metered" };
  }

  const address = draft.intendedCreatorAddress as `0x${string}` | null;

  if (!address) {
    return { kind: "missing_wallet" };
  }

  const chargeKind =
    priorReviewRuns === 0
      ? ("submission" as const)
      : priorReviewRuns < REVIEW_BOND_PRICING.includedReviewRuns
        ? null
        : ("extra_review" as const);
  const amountWad =
    chargeKind === "submission"
      ? REVIEW_BOND_PRICING.submissionChargeWad
      : chargeKind === "extra_review"
        ? REVIEW_BOND_PRICING.extraReviewChargeWad
        : 0n;

  let bond;

  try {
    bond = await dependencies.readBond(address);
  } catch {
    return { kind: "unavailable" };
  }

  const unsettledWad = await unsettledChargesWad(address);
  const effectiveAvailable = bond.availableWad - unsettledWad;

  if (
    bond.depositedWad < REVIEW_BOND_PRICING.minimumStandingBondWad ||
    effectiveAvailable < amountWad
  ) {
    return {
      availableWad: effectiveAvailable < 0n ? 0n : effectiveAvailable,
      kind: "insufficient",
      minimumStandingBondWad: REVIEW_BOND_PRICING.minimumStandingBondWad,
      requiredWad: amountWad,
      standingBondWad: bond.depositedWad,
    };
  }

  return { amountWad, chargeKind, kind: "chargeable" };
}

/** The creator's meter charges not yet covered by an on-chain settlement. */
export async function unsettledChargesWad(address: string): Promise<bigint> {
  const [row] = await db
    .select({
      total: sql<string>`coalesce(sum(${schema.draftReviewCharges.amount}), 0)`,
    })
    .from(schema.draftReviewCharges)
    .where(
      and(
        eq(schema.draftReviewCharges.chargedAddress, address.toLowerCase()),
        isNull(schema.draftReviewCharges.settledAt),
      ),
    );

  return BigInt(row?.total ?? "0");
}

/** The creator's lifetime metered consumption, settled and not. */
async function lifetimeChargesWad(address: string): Promise<bigint> {
  const [row] = await db
    .select({
      total: sql<string>`coalesce(sum(${schema.draftReviewCharges.amount}), 0)`,
    })
    .from(schema.draftReviewCharges)
    .where(eq(schema.draftReviewCharges.chargedAddress, address.toLowerCase()));

  return BigInt(row?.total ?? "0");
}

/** Reads the resolver key: its own env var, falling back to the shared local
 * dev keys the other server signers use. */
export function readBondResolverPrivateKey(
  env: Record<string, string | undefined> = process.env,
  networkName = config.name,
): `0x${string}` {
  const value =
    env.POPCHARTS_BOND_RESOLVER_PRIVATE_KEY ??
    env.POPCHARTS_DEVCHAIN_PRIVATE_KEY ??
    env.POPCHARTS_DEPLOYER_PRIVATE_KEY ??
    (networkName === "local" ? DEFAULT_LOCAL_RESOLVER_PRIVATE_KEY : undefined);

  if (!value) {
    throw new Error(
      "A bond resolver private key is required for review-fee settlement.",
    );
  }

  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("The bond resolver private key must be a 32-byte hex key.");
  }

  return value as `0x${string}`;
}

export type SettleDependencies = {
  settleOnChain: (
    address: `0x${string}`,
    consumedTotal: bigint,
  ) => Promise<void>;
};

const defaultSettleDependencies: SettleDependencies = {
  settleOnChain: async (address, consumedTotal) => {
    const account = privateKeyToAccount(readBondResolverPrivateKey());
    const walletClient = createWalletClient(account);
    const publicClient = createReadOnlyClient();
    const hash = await walletClient.writeContract({
      abi: reviewBondVaultAbi,
      address: config.contracts.reviewBondVault,
      functionName: "settle",
      args: [address, consumedTotal],
    });

    await publicClient.waitForTransactionReceipt({ hash });
  },
};

/**
 * Settles the creator's meter on-chain when the unsettled tally has reached
 * the threshold: the resolver attests the lifetime consumed total, and on
 * success the covered rows are stamped settled. Failures leave the rows
 * unsettled — the next charge retries — and the submission gate keeps
 * discounting them either way, so an unsettled meter can never be re-spent.
 * Fire-and-forget from the submit path; the money paper trail is the vault's
 * own event stream, indexed separately.
 */
export async function settleOutstandingCharges(
  address: string,
  dependencies: SettleDependencies = defaultSettleDependencies,
): Promise<"settled" | "skipped" | "failed"> {
  const normalized = address.toLowerCase() as `0x${string}`;
  const unsettled = await unsettledChargesWad(normalized);

  if (unsettled < SETTLE_THRESHOLD_WAD) {
    return "skipped";
  }

  const settledThrough = new Date();
  const lifetime = await lifetimeChargesWad(normalized);

  try {
    await dependencies.settleOnChain(normalized, lifetime);
  } catch (error) {
    console.warn(
      `[bond-meter] settlement for ${normalized} failed; charges stay unsettled and will retry`,
      error,
    );

    return "failed";
  }

  await db
    .update(schema.draftReviewCharges)
    .set({ settledAt: new Date() })
    .where(
      and(
        eq(schema.draftReviewCharges.chargedAddress, normalized),
        isNull(schema.draftReviewCharges.settledAt),
        sql`${schema.draftReviewCharges.createdAt} <= ${settledThrough}`,
      ),
    );

  return "settled";
}
