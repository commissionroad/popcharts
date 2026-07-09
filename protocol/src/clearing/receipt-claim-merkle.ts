import { concatHex, encodeAbiParameters, keccak256, toHex } from "viem";

/**
 * Contract-faithful receipt-claim leaf hashing and Merkle-tree construction for
 * graduation clearing. Mirrors PregradManager's `_hashReceiptClaim` (abi.encode
 * of the typehash + fields) and OpenZeppelin's commutative sorted-pair proof
 * verification, so a root built here verifies on-chain.
 */

/** keccak256 of the contract's ReceiptClaim typehash string. */
export const RECEIPT_CLAIM_TYPEHASH = keccak256(
  toHex(
    "ReceiptClaim(uint256 marketId,uint256 receiptId,address owner,uint8 side,uint256 retainedShares,uint256 retainedCost,uint256 refund)",
  ),
);

/** One per-receipt claim leaf committed by the clearing root. */
export type ReceiptClaim = {
  marketId: bigint;
  owner: `0x${string}`;
  receiptId: bigint;
  refund: bigint;
  retainedCost: bigint;
  retainedShares: bigint;
  side: number;
};

/** A contract-valid clearing plan: per-receipt claims plus conserved totals. */
export type ClearingPlan = {
  claims: ReceiptClaim[];
  completeSetCount: bigint;
  matchedMarketCap: bigint;
  merkleRoot: `0x${string}`;
  /** Merkle proof for each claim, index-aligned with `claims`. */
  proofs: `0x${string}`[][];
  refundTotal: bigint;
  retainedCostTotal: bigint;
  totalEscrowed: bigint;
};

/** Hashes a claim exactly like the contract's `hashReceiptClaim` view. */
export function hashReceiptClaim(claim: ReceiptClaim): `0x${string}` {
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

function commutativeKeccak(left: `0x${string}`, right: `0x${string}`): `0x${string}` {
  return left.toLowerCase() < right.toLowerCase()
    ? keccak256(concatHex([left, right]))
    : keccak256(concatHex([right, left]));
}
