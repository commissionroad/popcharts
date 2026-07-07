import { describe, expect, it } from "bun:test";
import { concatHex, keccak256 } from "viem";

import {
  buildClaimMerkleTree,
  buildDevClearingPlan,
  hashReceiptClaim,
  RECEIPT_CLAIM_TYPEHASH,
  type DevClearingReceipt,
} from "./dev-graduation-clearing";

const WAD = 10n ** 18n;

describe("buildDevClearingPlan", () => {
  it("matches exactly the graduation threshold and refunds the rest", () => {
    const receipts = [
      createReceipt({ cost: 30n * WAD, receiptId: 1n, shares: 60n * WAD }),
      createReceipt({
        cost: 45n * WAD,
        receiptId: 2n,
        shares: 90n * WAD,
        side: 1,
      }),
      createReceipt({ cost: 25n * WAD, receiptId: 3n, shares: 50n * WAD }),
    ];
    const plan = buildDevClearingPlan({
      graduationThreshold: 60n * WAD,
      receipts,
    });

    expect(plan.matchedMarketCap).toBe(60n * WAD);
    expect(plan.retainedCostTotal).toBe(60n * WAD);
    expect(plan.completeSetCount).toBe(60n * WAD);
    expect(plan.totalEscrowed).toBe(100n * WAD);
    expect(plan.refundTotal).toBe(40n * WAD);
    expect(plan.retainedCostTotal + plan.refundTotal).toBe(plan.totalEscrowed);
  });

  it("conserves cost per claim and caps retained shares at swept shares", () => {
    const receipts = [
      // Retained cost would exceed shares without the cap.
      createReceipt({ cost: 10n * WAD, receiptId: 1n, shares: 4n * WAD }),
      createReceipt({ cost: 6n * WAD, receiptId: 2n, shares: 12n * WAD }),
    ];
    const plan = buildDevClearingPlan({
      graduationThreshold: 12n * WAD,
      receipts,
    });

    for (const [index, claim] of plan.claims.entries()) {
      const receipt = receipts[index]!;
      expect(claim.retainedCost + claim.refund).toBe(receipt.cost);
      expect(claim.retainedShares <= receipt.shares).toBe(true);
    }
    expect(
      plan.claims.reduce((sum, claim) => sum + claim.retainedCost, 0n),
    ).toBe(plan.matchedMarketCap);
  });

  it("fills receipts in receipt-id order regardless of input order", () => {
    const plan = buildDevClearingPlan({
      graduationThreshold: 10n * WAD,
      receipts: [
        createReceipt({ cost: 20n * WAD, receiptId: 9n, shares: 40n * WAD }),
        createReceipt({ cost: 20n * WAD, receiptId: 2n, shares: 40n * WAD }),
      ],
    });

    expect(plan.claims[0]!.receiptId).toBe(2n);
    expect(plan.claims[0]!.retainedCost).toBe(10n * WAD);
    expect(plan.claims[1]!.receiptId).toBe(9n);
    expect(plan.claims[1]!.retainedCost).toBe(0n);
  });

  it("matches all escrow when the threshold is zero", () => {
    const plan = buildDevClearingPlan({
      graduationThreshold: 0n,
      receipts: [
        createReceipt({ cost: 8n * WAD, receiptId: 1n, shares: 16n * WAD }),
      ],
    });

    expect(plan.matchedMarketCap).toBe(8n * WAD);
    expect(plan.refundTotal).toBe(0n);
  });

  it("refuses plans the contract would reject", () => {
    expect(() =>
      buildDevClearingPlan({ graduationThreshold: WAD, receipts: [] }),
    ).toThrow("without receipts");
    expect(() =>
      buildDevClearingPlan({
        graduationThreshold: 10n * WAD,
        receipts: [
          createReceipt({ cost: 3n * WAD, receiptId: 1n, shares: 6n * WAD }),
        ],
      }),
    ).toThrow("cannot cover matched market cap");
  });
});

describe("hashReceiptClaim", () => {
  it("pins the ReceiptClaim typehash the contract commits to", () => {
    expect(RECEIPT_CLAIM_TYPEHASH).toBe(
      "0x904d34034d4553506945d94c5fc685b421aa267bbddeebc32309bead1feafa9a",
    );
  });
});

describe("buildClaimMerkleTree", () => {
  it("uses the single leaf as the root with an empty proof", () => {
    const leaf = hashReceiptClaim(
      buildDevClearingPlan({
        graduationThreshold: WAD,
        receipts: [
          createReceipt({ cost: 2n * WAD, receiptId: 1n, shares: 4n * WAD }),
        ],
      }).claims[0]!,
    );
    const tree = buildClaimMerkleTree([leaf]);

    expect(tree.root).toBe(leaf);
    expect(tree.proofs).toEqual([[]]);
  });

  it("produces proofs that verify with commutative sorted-pair keccak", () => {
    for (const leafCount of [2, 3, 5, 8]) {
      const leaves = Array.from({ length: leafCount }, (_, index) =>
        keccak256(`0x${(index + 1).toString(16).padStart(64, "0")}`),
      );
      const tree = buildClaimMerkleTree(leaves);

      for (const [index, leaf] of leaves.entries()) {
        expect(verifyProof(tree.proofs[index]!, tree.root, leaf)).toBe(true);
      }
      // A proof for one leaf must not verify another leaf.
      expect(verifyProof(tree.proofs[0]!, tree.root, leaves[1]!)).toBe(false);
    }
  });
});

/** Mirrors the OpenZeppelin MerkleProof fold the contract verifies with. */
function verifyProof(
  proof: `0x${string}`[],
  root: `0x${string}`,
  leaf: `0x${string}`,
) {
  let computed = leaf;

  for (const sibling of proof) {
    computed =
      computed.toLowerCase() < sibling.toLowerCase()
        ? keccak256(concatHex([computed, sibling]))
        : keccak256(concatHex([sibling, computed]));
  }

  return computed === root;
}

function createReceipt(
  overrides: Partial<DevClearingReceipt> & {
    cost: bigint;
    receiptId: bigint;
    shares: bigint;
  },
): DevClearingReceipt {
  return {
    marketId: 7n,
    owner: "0x00000000000000000000000000000000000000aa",
    side: 0,
    ...overrides,
  };
}
