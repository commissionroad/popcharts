import { network } from "hardhat";
import { getAddress, isAddress, type Address } from "viem";

import { reviewCreditVaultAbi } from "../src/generated/review-credit-vault.js";

/**
 * Deposits prepaid review credit for a beneficiary on the local devchain
 * (repo ADR 0022, prepaid-credit amendment). It owns only the one on-chain
 * action, exactly like publish-authorized-market.ts does for creation: the
 * root `local-create-market` orchestrator decides *when* a top-up is needed
 * (the API refuses a submission with 402) and shells this to perform it,
 * because root scripts carry no chain tooling of their own.
 *
 * The beneficiary is an explicit input, never the sender: credit is
 * non-refundable and nothing can move it afterwards, so the account paying
 * and the account credited must be stated separately even when they match.
 */

const vaultAddress = readAddress("LOCAL_REVIEW_CREDIT_VAULT_ADDRESS");
const beneficiary = readAddress("POPCHARTS_CREDIT_BENEFICIARY");
const amountWad = readAmountWad("POPCHARTS_CREDIT_AMOUNT_WAD");

const { viem } = await network.create();
const [payer] = await viem.getWalletClients();

if (!payer) {
  throw new Error("Expected the local Hardhat network to expose a payer account.");
}

const publicClient = await viem.getPublicClient();
const vault = await viem.getContractAt("ReviewCreditVault", vaultAddress);

const transactionHash = await vault.write.depositFor([beneficiary], {
  value: amountWad,
});
const receipt = await publicClient.waitForTransactionReceipt({
  hash: transactionHash,
});

// Lifetime deposits, read back rather than assumed: the caller waits for this
// figure to appear in the server's indexed view before retrying, and a deposit
// that did not land must not be reported as one that did.
const depositedWad = (await publicClient.readContract({
  abi: reviewCreditVaultAbi,
  address: vaultAddress,
  args: [beneficiary],
  functionName: "depositedOf",
})) as bigint;

// One parseable line for the root orchestrator, same shape the other local
// helpers emit.
emitJson("LOCAL_REVIEW_CREDIT_DEPOSIT", {
  amountWad: amountWad.toString(),
  beneficiary,
  blockNumber: receipt.blockNumber.toString(),
  depositedWad: depositedWad.toString(),
  payer: getAddress(payer.account.address),
  transactionHash,
});

function readAddress(name: string): Address {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  if (!isAddress(value)) {
    throw new Error(`${name} must be an EVM address; received ${value}`);
  }

  return getAddress(value);
}

function readAmountWad(name: string): bigint {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be a non-negative integer in wei; received ${value}`);
  }

  const amount = BigInt(value);

  if (amount === 0n) {
    // The vault reverts on a zero deposit; failing here names the cause.
    throw new Error(`${name} must be greater than zero.`);
  }

  return amount;
}

function emitJson(label: string, value: unknown) {
  console.log(`${label}=${JSON.stringify(value)}`);
}
