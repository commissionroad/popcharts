import type { ConnectedWallet } from "@privy-io/react-auth";
import { describe, expect, it } from "vitest";

import {
  findWalletByAddress,
  getWalletErrorMessage,
  parseEip155ChainId,
  summarizeWallet,
} from "./wallet-utilities";

describe("findWalletByAddress", () => {
  it("matches addresses case-insensitively", () => {
    const wallet = connectedWallet({
      address: "0xABCDEF0000000000000000000000000000000001",
    });

    expect(
      findWalletByAddress([wallet], "0xabcdef0000000000000000000000000000000001")
    ).toBe(wallet);
  });

  it("returns undefined for a missing or unknown address", () => {
    const wallets = [connectedWallet()];

    expect(findWalletByAddress(wallets, null)).toBeUndefined();
    expect(findWalletByAddress(wallets, undefined)).toBeUndefined();
    expect(
      findWalletByAddress(wallets, "0x9999999999999999999999999999999999999999")
    ).toBeUndefined();
  });
});

describe("parseEip155ChainId", () => {
  it("parses the numeric chain id from an eip155 identifier", () => {
    expect(parseEip155ChainId("eip155:31337")).toBe(31337);
    expect(parseEip155ChainId("eip155:1")).toBe(1);
  });

  it("rejects other formats", () => {
    expect(parseEip155ChainId(undefined)).toBeNull();
    expect(parseEip155ChainId("31337")).toBeNull();
    expect(parseEip155ChainId("solana:x")).toBeNull();
    expect(parseEip155ChainId("eip155:not-a-number")).toBeNull();
  });
});

describe("summarizeWallet", () => {
  it("summarizes an active linked wallet", () => {
    const wallet = connectedWallet({
      address: "0xABCDEF0000000000000000000000000000000001",
      chainId: "eip155:31337",
      linked: true,
    });

    const summary = summarizeWallet(
      wallet,
      "0xabcdef0000000000000000000000000000000001"
    );

    expect(summary).toEqual({
      active: true,
      address: "0xABCDEF0000000000000000000000000000000001",
      chainId: 31337,
      displayAddress: "0xABC...001",
      label: "Test Wallet",
      linked: true,
      walletClientType: "privy",
    });
  });

  it("is inactive without an active address", () => {
    expect(summarizeWallet(connectedWallet(), null).active).toBe(false);
    expect(summarizeWallet(connectedWallet(), undefined).active).toBe(false);
  });

  it("derives a label from the client type when the wallet has no name", () => {
    const wallet = connectedWallet({
      meta: { name: "" },
      walletClientType: "coinbase_smart_wallet",
    });

    expect(summarizeWallet(wallet, null).label).toBe("Coinbase Smart Wallet");
  });
});

describe("getWalletErrorMessage", () => {
  it("passes real error messages through", () => {
    expect(getWalletErrorMessage(new Error("User rejected signing."))).toBe(
      "User rejected signing."
    );
  });

  it("falls back for empty messages and non-Error values", () => {
    const fallback = "Wallet action failed. Try again from your wallet.";

    expect(getWalletErrorMessage(new Error(""))).toBe(fallback);
    expect(getWalletErrorMessage("boom")).toBe(fallback);
    expect(getWalletErrorMessage(undefined)).toBe(fallback);
  });
});

function connectedWallet(overrides: Record<string, unknown> = {}): ConnectedWallet {
  return {
    address: "0x1111111111111111111111111111111111111111",
    chainId: "eip155:31337",
    linked: false,
    meta: { name: "Test Wallet" },
    walletClientType: "privy",
    ...overrides,
  } as unknown as ConnectedWallet;
}
