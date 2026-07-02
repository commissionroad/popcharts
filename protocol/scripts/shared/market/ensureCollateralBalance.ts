import { erc20Abi, type Address, type Hex, type PublicClient } from "viem";

const LOCAL_DEVCHAIN_CHAIN_ID = 31_337;

const MINTABLE_COLLATERAL_ABI = [
  {
    inputs: [
      { name: "account", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "mint",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

type CollateralMintWriter = {
  writeContract(parameters: {
    abi: typeof MINTABLE_COLLATERAL_ABI;
    address: Address;
    args: readonly [Address, bigint];
    functionName: "mint";
  }): Promise<Hex>;
};

/**
 * Ensures the smoke account holds at least `requiredAmount` collateral before
 * a flow spends it. On the local devchain the shortfall is minted through the
 * mock collateral's permissionless `mint`; on real chains the flow fails with
 * the shortfall and the env var that sizes the requirement, so operators fund
 * the account instead of hitting a mid-flow transfer revert.
 */
export async function ensureCollateralBalance(args: {
  readonly chainId: number;
  readonly collateral: Address;
  readonly owner: Address;
  readonly publicClient: PublicClient;
  readonly requiredAmount: bigint;
  readonly requirementLabel: string;
  readonly walletClient: CollateralMintWriter;
}): Promise<void> {
  const balance = await readBalance(args);
  if (balance >= args.requiredAmount) {
    return;
  }

  const shortfall = args.requiredAmount - balance;
  if (args.chainId !== LOCAL_DEVCHAIN_CHAIN_ID) {
    throw new Error(
      `Account ${args.owner} holds ${balance} raw units of collateral ${args.collateral} but ` +
        `${args.requirementLabel} needs ${args.requiredAmount}. Fund the account or lower the amount.`,
    );
  }

  let mintHash: Hex;
  try {
    mintHash = await args.walletClient.writeContract({
      abi: MINTABLE_COLLATERAL_ABI,
      address: args.collateral,
      args: [args.owner, shortfall],
      functionName: "mint",
    });
  } catch (error) {
    throw new Error(
      `Account ${args.owner} is short ${shortfall} raw units of collateral ${args.collateral} ` +
        `for ${args.requirementLabel}, and minting on the local devchain failed ` +
        `(is the collateral the MockCollateral from pnpm local:deploy-pregrad?): ${String(error)}`,
    );
  }
  await args.publicClient.waitForTransactionReceipt({ hash: mintHash });

  const fundedBalance = await readBalance(args);
  if (fundedBalance < args.requiredAmount) {
    throw new Error(
      `Minted local collateral but ${args.owner} still holds ${fundedBalance} raw units, ` +
        `below the ${args.requiredAmount} required for ${args.requirementLabel}.`,
    );
  }
  console.log(
    `Minted ${shortfall} raw units of local mock collateral for ${args.requirementLabel}.`,
  );
}

async function readBalance(args: {
  readonly collateral: Address;
  readonly owner: Address;
  readonly publicClient: PublicClient;
}): Promise<bigint> {
  return args.publicClient.readContract({
    abi: erc20Abi,
    address: args.collateral,
    args: [args.owner],
    functionName: "balanceOf",
  });
}
