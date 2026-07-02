import { getAddress, type Address, type Hex, type PublicClient } from "viem";

const ORDER_MANAGER_GET_ORDER_ABI = [
  {
    inputs: [
      { name: "poolId", type: "bytes32" },
      { name: "orderId", type: "uint32" },
    ],
    name: "getOrder",
    outputs: [
      {
        components: [
          { name: "owner", type: "address" },
          { name: "zeroForOne", type: "bool" },
          { name: "tickLower", type: "int24" },
          { name: "tickUpper", type: "int24" },
          { name: "indexedTick", type: "int24" },
          { name: "liquidity", type: "uint128" },
          { name: "enablePartialFill", type: "bool" },
        ],
        name: "order",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

/** Stored order-manager state for one maker order; zero owner means deleted. */
export type BoundedOrderState = {
  readonly enablePartialFill: boolean;
  readonly indexedTick: number;
  readonly liquidity: bigint;
  readonly owner: Address;
  readonly tickLower: number;
  readonly tickUpper: number;
  readonly zeroForOne: boolean;
};

/**
 * Reads one maker order from the bounded order manager with a checksummed
 * owner, so smoke and inspection flows share the getOrder tuple decoding and
 * the "zero owner means filled or cancelled" convention.
 */
export async function readBoundedOrder(args: {
  readonly orderId: number;
  readonly orderManager: Address;
  readonly poolId: Hex;
  readonly publicClient: PublicClient;
}): Promise<BoundedOrderState> {
  const order = await args.publicClient.readContract({
    abi: ORDER_MANAGER_GET_ORDER_ABI,
    address: args.orderManager,
    args: [args.poolId, args.orderId],
    functionName: "getOrder",
  });
  return { ...order, owner: getAddress(order.owner) };
}
