import {
  completeSetBinaryMarketAbi,
  completeSetPostgradAdapterAbi,
  marketSideToContractSide,
  pregradManagerAbi,
  type MarketSide,
} from "@popcharts/protocol";
import { type Address } from "viem";

import { retryOnceOnNonceCollision } from "src/blockchain/nonce-collision";

import {
  LOCAL_DEV_ACCOUNT_COUNT,
  postgradAdapterAddress,
  pregradManagerAddress,
  publicClient,
  walletFor,
} from "./stack";

/**
 * Operator actions for lifecycle scenarios. Operator moves are keyed direct
 * contract calls — never API endpoints — mirroring the real operator model
 * (dev/admin endpoints are excluded from prod builds; operators act with a
 * local key). Both signers here are service-shared accounts, so writes race
 * service nonces in a narrow window; retryOnceOnNonceCollision absorbs the
 * rare collision instead of failing the nightly.
 */

/**
 * Cancels a postgrad market (the draw outcome) with its on-chain resolver
 * key, located among the local dev accounts the way an operator would look
 * it up.
 */
export async function cancelPostgradMarketAsResolver(
  postgradMarketAddress: Address,
): Promise<void> {
  const resolver = await resolverWalletFor(postgradMarketAddress);

  await sendOperatorTransaction("postgrad cancel", () =>
    resolver.writeContract({
      abi: completeSetBinaryMarketAbi,
      address: postgradMarketAddress,
      functionName: "cancel",
      args: [],
    }),
  );
}

/**
 * Settles a disputed market to `side` with the resolver key. From Disputed,
 * `resolve` carries no time gates — a human is adjudicating contested facts —
 * and it settles the disputer's bond: refunded when the outcome differs from
 * the proposal, forfeited to the owner when it does not.
 */
export async function settleDisputedPostgradMarketAsResolver(
  postgradMarketAddress: Address,
  side: MarketSide,
): Promise<void> {
  const resolver = await resolverWalletFor(postgradMarketAddress);

  await sendOperatorTransaction("postgrad dispute settlement", () =>
    resolver.writeContract({
      abi: completeSetBinaryMarketAbi,
      address: postgradMarketAddress,
      functionName: "resolve",
      args: [marketSideToContractSide(side)],
    }),
  );
}

/** Dispute parameters the adapter stamps into each market at graduation. */
export type PostgradDisputeConfig = {
  disputeBond: bigint;
  disputeWindow: bigint;
};

/**
 * Retunes the adapter's dispute parameters as its owner and returns the values
 * it replaced, so a scenario can restore them.
 *
 * Local stacks deploy the adapter with both set to zero, which degenerates to
 * the single-step resolve path — a scenario that needs a real dispute window
 * retunes the adapter before graduating its own market rather than changing
 * that global default, since the values are stamped per market at graduation
 * and markets already deployed keep theirs.
 */
export async function setPostgradDisputeConfig(
  next: PostgradDisputeConfig,
): Promise<PostgradDisputeConfig> {
  const [owner, disputeBond, disputeWindow] = await Promise.all([
    publicClient.readContract({
      abi: completeSetPostgradAdapterAbi,
      address: postgradAdapterAddress,
      functionName: "owner",
    }),
    publicClient.readContract({
      abi: completeSetPostgradAdapterAbi,
      address: postgradAdapterAddress,
      functionName: "disputeBond",
    }),
    publicClient.readContract({
      abi: completeSetPostgradAdapterAbi,
      address: postgradAdapterAddress,
      functionName: "disputeWindow",
    }),
  ]);
  const ownerWallet = localWalletFor(
    owner as Address,
    "postgrad adapter owner",
  );

  await sendOperatorTransaction("setDisputeConfig", () =>
    ownerWallet.writeContract({
      abi: completeSetPostgradAdapterAbi,
      address: postgradAdapterAddress,
      functionName: "setDisputeConfig",
      args: [next.disputeWindow, next.disputeBond],
    }),
  );

  return { disputeBond, disputeWindow: BigInt(disputeWindow) };
}

/**
 * Ensures `creator` may create markets with a zeroed authorization, the way
 * the market factory does. Local deploys trust only the deployer (repo
 * ADR 0022 P5 retired the ungated create path), so on a fresh chain the
 * nightly's creator wallet starts untrusted and the first scenario registers
 * it here with the owner key — the same keyed operator move a real operator
 * would make. The read gate keeps replays from re-sending.
 */
export async function ensureTrustedCreator(creator: Address): Promise<void> {
  const alreadyTrusted = await publicClient.readContract({
    abi: pregradManagerAbi,
    address: pregradManagerAddress,
    functionName: "isTrustedCreator",
    args: [creator],
  });
  if (alreadyTrusted) {
    return;
  }

  const owner = await publicClient.readContract({
    abi: pregradManagerAbi,
    address: pregradManagerAddress,
    functionName: "owner",
  });
  const ownerWallet = localWalletFor(owner as Address, "pregrad manager owner");

  await sendOperatorTransaction("setTrustedCreator", () =>
    ownerWallet.writeContract({
      abi: pregradManagerAbi,
      address: pregradManagerAddress,
      functionName: "setTrustedCreator",
      args: [creator, true],
    }),
  );
}

/**
 * Sets the pre-graduation entry fee rate on the PregradManager as its owner
 * and returns the rate it replaced, so a scenario can restore it.
 *
 * This is the same `setEntryFeeRate` call the production arming path makes
 * (protocol ADR 0014 P4a; `local:set-entry-fee-rate` wraps it for a shell).
 * Local stacks deploy with the rate at zero — the fee ships disarmed — and
 * the rate is global to the manager, so a scenario that needs the fee armed
 * brackets its own placements with this rather than changing that deploy
 * default. The fee actually charged is stamped per receipt at placeReceipt,
 * so receipts already placed keep theirs across a rate change.
 */
export async function setEntryFeeRateAsOwner(
  newRateWad: bigint,
): Promise<bigint> {
  const [owner, previousRateWad] = await Promise.all([
    publicClient.readContract({
      abi: pregradManagerAbi,
      address: pregradManagerAddress,
      functionName: "owner",
    }),
    publicClient.readContract({
      abi: pregradManagerAbi,
      address: pregradManagerAddress,
      functionName: "entryFeeRateWad",
    }),
  ]);
  const ownerWallet = localWalletFor(owner as Address, "pregrad manager owner");

  await sendOperatorTransaction("setEntryFeeRate", () =>
    ownerWallet.writeContract({
      abi: pregradManagerAbi,
      address: pregradManagerAddress,
      functionName: "setEntryFeeRate",
      args: [newRateWad],
    }),
  );

  return previousRateWad as bigint;
}

/** The local dev wallet holding a market's on-chain resolver role. */
async function resolverWalletFor(postgradMarketAddress: Address) {
  const resolver = (await publicClient.readContract({
    abi: completeSetBinaryMarketAbi,
    address: postgradMarketAddress,
    functionName: "resolver",
  })) as Address;

  return localWalletFor(resolver, "postgrad resolver");
}

/** Looks an on-chain role up among the local dev accounts, as an operator would. */
function localWalletFor(address: Address, role: string) {
  for (let index = 0; index < LOCAL_DEV_ACCOUNT_COUNT; index += 1) {
    const wallet = walletFor(index);
    if (wallet.account.address.toLowerCase() === address.toLowerCase()) {
      return wallet;
    }
  }

  throw new Error(`${role} ${address} is not a local dev account.`);
}

async function sendOperatorTransaction(
  label: string,
  send: () => Promise<`0x${string}`>,
): Promise<void> {
  const transactionHash = await retryOnceOnNonceCollision(send);
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: transactionHash,
  });

  if (receipt.status !== "success") {
    throw new Error(`${label} reverted: ${transactionHash}`);
  }
}
