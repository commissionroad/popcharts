import { TransactionStatus, type ListTransactionsResult } from "@nomicfoundation/ignition-core";
import { getAddress, type Address } from "viem";

/**
 * Finds the successful Ignition transaction that created a deployed address.
 */
export function findDeploymentTransaction({
  address,
  transactions,
}: {
  address: Address;
  transactions: ListTransactionsResult;
}) {
  return transactions.find((transaction) => {
    return (
      transaction.status === TransactionStatus.SUCCESS &&
      transaction.address !== undefined &&
      getAddress(transaction.address) === address
    );
  });
}
