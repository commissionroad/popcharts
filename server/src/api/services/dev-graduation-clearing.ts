import { concatHex, encodeAbiParameters, keccak256, toHex } from "viem";

/**
 * Offchain clearing plan for the dev graduation flow.
 *
 * The real clearing service sweeps price bands to decide which receipt
 * segments matched. For local smoke testing we only need a plan the contract
 * accepts: per-receipt claims whose totals conserve escrow
 * (retainedCostTotal + refundTotal == totalEscrowed) and whose matched cap
 * meets the graduation threshold (retainedCostTotal == matchedMarketCap ==
 * completeSetCount >= threshold). This module fills receipts greedily in
 * placement order until the threshold is covered and refunds the rest.
 */

/** Matches keccak256 of the contract's ReceiptClaim typehash string. */
export const RECEIPT_CLAIM_TYPEHASH = keccak256(
  toHex(
    "ReceiptClaim(uint256 marketId,uint256 receiptId,address owner,uint8 side,uint256 retainedShares,uint256 retainedCost,uint256 refund)",
  ),
);

/** A pre-graduation receipt as read from ReceiptPlaced logs. */
export type DevClearingReceipt = {
  cost: bigint;
  marketId: bigint;
  owner: `0x${string}`;
  receiptId: bigint;
  shares: bigint;
  side: number;
};

/** One per-receipt claim leaf committed by the clearing root. */
export type DevReceiptClaim = {
  marketId: bigint;
  owner: `0x${string}`;
  receiptId: bigint;
  refund: bigint;
  retainedCost: bigint;
  retainedShares: bigint;
  side: number;
};

export type DevClearingPlan = {
  claims: DevReceiptClaim[];
  completeSetCount: bigint;
  matchedMarketCap: bigint;
  merkleRoot: `0x${string}`;
  /** Merkle proof for each claim, index-aligned with `claims`. */
  proofs: `0x${string}`[][];
  refundTotal: bigint;
  retainedCostTotal: bigint;
  totalEscrowed: bigint;
};

/**
 * Builds a contract-valid clearing plan from a market's receipts. Matches
 * exactly the graduation threshold (or all escrow when the threshold is zero)
 * and refunds the remainder, so the plan exercises both the postgrad mint and
 * the refund path. Throws when the receipts cannot cover the threshold —
 * callers must top up escrow first.
 */
export function buildDevClearingPlan({
  graduationThreshold,
  receipts,
}: {
  graduationThreshold: bigint;
  receipts: DevClearingReceipt[];
}): DevClearingPlan {
  if (receipts.length === 0) {
    throw new Error("Cannot build a clearing plan without receipts.");
  }

  const orderedReceipts = [...receipts].sort((left, right) =>
    left.receiptId < right.receiptId ? -1 : 1,
  );
  const totalEscrowed = orderedReceipts.reduce(
    (sum, receipt) => sum + receipt.cost,
    0n,
  );
  const matchedMarketCap =
    graduationThreshold > 0n ? graduationThreshold : totalEscrowed;

  if (matchedMarketCap === 0n) {
    throw new Error("Cannot build a clearing plan with zero escrow.");
  }

  if (totalEscrowed < matchedMarketCap) {
    throw new Error(
      `Escrow ${totalEscrowed} cannot cover matched market cap ${matchedMarketCap}.`,
    );
  }

  let remaining = matchedMarketCap;
  const claims = orderedReceipts.map((receipt) => {
    const retainedCost = receipt.cost < remaining ? receipt.cost : remaining;
    remaining -= retainedCost;

    return {
      marketId: receipt.marketId,
      owner: receipt.owner,
      receiptId: receipt.receiptId,
      refund: receipt.cost - retainedCost,
      retainedCost,
      // Retained shares mint postgrad outcome tokens one-for-one with retained
      // collateral, capped by the receipt's swept shares as the contract
      // requires.
      retainedShares:
        retainedCost < receipt.shares ? retainedCost : receipt.shares,
      side: receipt.side,
    };
  });
  const { proofs, root } = buildClaimMerkleTree(claims.map(hashReceiptClaim));

  return {
    claims,
    completeSetCount: matchedMarketCap,
    matchedMarketCap,
    merkleRoot: root,
    proofs,
    refundTotal: totalEscrowed - matchedMarketCap,
    retainedCostTotal: matchedMarketCap,
    totalEscrowed,
  };
}

/** Hashes a claim exactly like the contract's `hashReceiptClaim` view. */
export function hashReceiptClaim(claim: DevReceiptClaim): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "address" },
        { type: "uint8" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
      ],
      [
        RECEIPT_CLAIM_TYPEHASH,
        claim.marketId,
        claim.receiptId,
        claim.owner,
        claim.side,
        claim.retainedShares,
        claim.retainedCost,
        claim.refund,
      ],
    ),
  );
}

/**
 * Builds a Merkle tree over claim leaves using the commutative sorted-pair
 * keccak the contract's proof verification expects. Odd nodes are promoted to
 * the next level unhashed, which the fold-style verifier handles naturally.
 */
export function buildClaimMerkleTree(leaves: `0x${string}`[]): {
  proofs: `0x${string}`[][];
  root: `0x${string}`;
} {
  if (leaves.length === 0) {
    throw new Error("Cannot build a Merkle tree without leaves.");
  }

  const proofs = leaves.map(() => [] as `0x${string}`[]);
  // Track which original leaf each node at the current level descends from so
  // sibling hashes land in the right proofs.
  let level = leaves.map((leaf, index) => ({ hash: leaf, leaves: [index] }));

  while (level.length > 1) {
    const nextLevel: typeof level = [];

    for (let index = 0; index < level.length; index += 2) {
      const left = level[index]!;
      const right = level[index + 1];

      if (!right) {
        nextLevel.push(left);
        continue;
      }

      for (const leafIndex of left.leaves) {
        proofs[leafIndex]!.push(right.hash);
      }
      for (const leafIndex of right.leaves) {
        proofs[leafIndex]!.push(left.hash);
      }
      nextLevel.push({
        hash: commutativeKeccak(left.hash, right.hash),
        leaves: [...left.leaves, ...right.leaves],
      });
    }

    level = nextLevel;
  }

  return { proofs, root: level[0]!.hash };
}

function commutativeKeccak(
  left: `0x${string}`,
  right: `0x${string}`,
): `0x${string}` {
  return left.toLowerCase() < right.toLowerCase()
    ? keccak256(concatHex([left, right]))
    : keccak256(concatHex([right, left]));
}
