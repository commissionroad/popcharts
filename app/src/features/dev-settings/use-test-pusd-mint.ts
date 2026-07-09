"use client";

import { useState } from "react";
import { usePublicClient, useWalletClient } from "wagmi";

import {
  canMintLocalCollateral,
  mintLocalCollateral,
} from "@/features/receipt-ticket/place-receipt-service";
import { getPopChartsContractConfig } from "@/integrations/contracts/config";
import { useWalletAccount } from "@/integrations/wallet/wallet-provider";
import { presentError } from "@/lib/error-handling";

import { dispatchTestPusdMinted } from "./test-pusd-events";

const TEST_MINT_AMOUNT_USD = 10_000;

export type TestPusdMintResult =
  | {
      status: "error";
      message: string;
    }
  | {
      status: "success";
      message: string;
    };

export type TestPusdMintAction = {
  disabled: boolean;
  label: string;
  onClick: (() => void) | undefined;
};

export function useTestPusdMint(): {
  action: TestPusdMintAction;
  isMinting: boolean;
  result: TestPusdMintResult | null;
} {
  const config = getPopChartsContractConfig();
  const wallet = useWalletAccount();
  const publicClient = usePublicClient({ chainId: config?.chainId });
  const { data: walletClient } = useWalletClient({ chainId: config?.chainId });
  const [isMinting, setIsMinting] = useState(false);
  const [result, setResult] = useState<TestPusdMintResult | null>(null);
  const canMint = config !== null && canMintLocalCollateral(config);

  async function runMint() {
    if (!config || !wallet.address || !publicClient || !walletClient) {
      return;
    }

    setIsMinting(true);
    setResult(null);

    try {
      await mintLocalCollateral({
        amountUsd: TEST_MINT_AMOUNT_USD,
        config,
        wallet: {
          accountAddress: wallet.address as `0x${string}`,
          activeChainId: wallet.activeChainId,
          publicClient,
          walletClient,
        },
      });
      dispatchTestPusdMinted();
      setResult({
        message: "Added 10,000 test pUSD to your wallet.",
        status: "success",
      });
    } catch (error) {
      setResult({
        message: presentError(error, {
          context: { operation: "test-pusd-mint" },
          fallback: "Could not get pUSD.",
        }),
        status: "error",
      });
    } finally {
      setIsMinting(false);
    }
  }

  function clearAndRun(action: () => void) {
    return () => {
      setResult(null);
      action();
    };
  }

  const action = getTestPusdMintAction({
    canMint,
    isMinting,
    publicClientReady: Boolean(publicClient),
    runMint,
    wallet,
    walletClientReady: Boolean(walletClient),
    walletChainId: config?.chainId ?? null,
  });

  if (action.onClick && action.onClick !== runMint) {
    return {
      action: { ...action, onClick: clearAndRun(action.onClick) },
      isMinting,
      result,
    };
  }

  return { action, isMinting, result };
}

function getTestPusdMintAction({
  canMint,
  isMinting,
  publicClientReady,
  runMint,
  wallet,
  walletChainId,
  walletClientReady,
}: {
  canMint: boolean;
  isMinting: boolean;
  publicClientReady: boolean;
  runMint: () => void;
  wallet: ReturnType<typeof useWalletAccount>;
  walletChainId: number | null;
  walletClientReady: boolean;
}): TestPusdMintAction {
  if (isMinting) {
    return { disabled: true, label: "Getting pUSD", onClick: undefined };
  }

  if (!canMint || walletChainId === null) {
    return { disabled: true, label: "Local pUSD unavailable", onClick: undefined };
  }

  if (!wallet.enabled) {
    return { disabled: true, label: "Wallet unavailable", onClick: undefined };
  }

  if (!wallet.ready) {
    return { disabled: true, label: "Preparing wallet", onClick: undefined };
  }

  if (!wallet.authenticated) {
    return {
      disabled: false,
      label: "Sign in to get pUSD",
      onClick: wallet.login,
    };
  }

  if (!wallet.address) {
    return {
      disabled: false,
      label: "Create or link wallet",
      onClick: wallet.connectOrCreateWallet,
    };
  }

  if (!wallet.isSupportedChain || wallet.activeChainId !== walletChainId) {
    return {
      disabled: Boolean(wallet.pendingAction),
      label: `Switch to ${wallet.defaultChain.name}`,
      onClick: () => void wallet.switchChain(walletChainId),
    };
  }

  if (!publicClientReady || !walletClientReady) {
    return { disabled: true, label: "Preparing wallet client", onClick: undefined };
  }

  return { disabled: false, label: "Get pUSD", onClick: runMint };
}
