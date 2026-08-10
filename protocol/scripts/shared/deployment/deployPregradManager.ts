import type { network } from "hardhat";

type LocalNetworkViem = Awaited<ReturnType<typeof network.create>>["viem"];

/**
 * Deploys the ReceiptWithdrawals external library and a PregradManager linked
 * against it. The withdrawal state machine (ADR 0014 P3) lives in that
 * delegatecalled library because the manager sits near the EIP-170 code-size
 * limit, so every manager deployment is this two-step deploy. Solidity test
 * fixtures link automatically; every viem deploy path goes through here.
 */
export async function deployPregradManager(viem: LocalNetworkViem) {
  const receiptWithdrawals = await viem.deployContract("ReceiptWithdrawals");
  return viem.deployContract("PregradManager", [], {
    libraries: { ReceiptWithdrawals: receiptWithdrawals.address },
  });
}
