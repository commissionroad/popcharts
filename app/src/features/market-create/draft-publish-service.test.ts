import type { MarketDraftPublishParams } from "@popcharts/api-client/models";
import type { PublicClient, WalletClient } from "viem";
import { encodeAbiParameters, encodeEventTopics } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PopChartsContractConfig } from "@/integrations/contracts/config";
import { pregradManagerAbi } from "@/integrations/contracts/pregrad-manager";

import type { CreateMarketWallet } from "./create-market-service";
import { persistPublishedMetadata, publishDraftMarket } from "./draft-publish-service";

const configState = vi.hoisted(() => ({
  config: null as unknown,
  // When non-empty, each config read consumes the next queued value so tests
  // can vary what consecutive getPopChartsContractConfig calls observe.
  queue: [] as unknown[],
}));

vi.mock("@/integrations/contracts/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/integrations/contracts/config")>()),
  getPopChartsContractConfig: () =>
    configState.queue.length > 0 ? configState.queue.shift() : configState.config,
}));

const WAD = 10n ** 18n;
const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const PUBLISH_HASH = `0x${"cc".repeat(32)}` as const;
const METADATA_HASH = `0x${"ab".repeat(32)}` as const;

const contractConfig: PopChartsContractConfig = {
  chainEnv: "local",
  chainId: 31337,
  collateralAddress: "0x0000000000000000000000000000000000000002",
  nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
  pregradManagerAddress: "0x0000000000000000000000000000000000000001",
  rpcUrl: "http://127.0.0.1:8545",
};

afterEach(() => {
  vi.unstubAllGlobals();
  configState.config = null;
  configState.queue = [];
});

describe("publishDraftMarket", () => {
  it("fails fast when the contract configuration is incomplete", async () => {
    const { wallet } = mockWallet();

    await expect(
      publishDraftMarket({ params: publishParams(), wallet })
    ).rejects.toThrow("Devchain contract configuration is incomplete.");
  });

  it("requires the wallet to be on the configured chain", async () => {
    configState.config = contractConfig;
    const { clients, wallet } = mockWallet();
    wallet.activeChainId = 1;

    await expect(
      publishDraftMarket({ params: publishParams(), wallet })
    ).rejects.toThrow("Switch your wallet to chain 31337 before publishing.");
    expect(clients.writeContract).not.toHaveBeenCalled();
  });

  it("fails when the configuration disappears before the fee read", async () => {
    configState.queue = [contractConfig, null];
    const { wallet } = mockWallet();

    await expect(
      publishDraftMarket({ params: publishParams(), wallet })
    ).rejects.toThrow("Devchain contract configuration is incomplete.");
  });

  it("rejects publishing when the balance cannot cover the creation fee", async () => {
    configState.config = contractConfig;
    const { clients, wallet } = mockWallet();
    clients.creationFee = (15n * WAD) / 10n;
    clients.balance = WAD / 2n;

    await expect(
      publishDraftMarket({ params: publishParams(), wallet })
    ).rejects.toThrow(
      "Publishing costs 1.50 native USDC. Your wallet has 0.50 available."
    );
    expect(clients.writeContract).not.toHaveBeenCalled();
  });

  it("skips the balance check when publishing is free", async () => {
    configState.config = contractConfig;
    const { clients, wallet } = mockWallet();
    clients.creationFee = 0n;

    const published = await publishDraftMarket({ params: publishParams(), wallet });

    expect(published.marketId).toBe("9");
    expect(clients.getBalance).not.toHaveBeenCalled();
    expect(clients.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "createMarket", value: 0n })
    );
  });

  it("fails when the transaction confirms without a MarketCreated event", async () => {
    configState.config = contractConfig;
    const { clients, wallet } = mockWallet();
    clients.creationLogs = [];

    await expect(
      publishDraftMarket({ params: publishParams(), wallet })
    ).rejects.toThrow("Transaction succeeded but MarketCreated was not emitted.");
  });

  it("signs with the server-minted params and returns the chain's own answer", async () => {
    configState.config = contractConfig;
    const { clients, wallet } = mockWallet();

    const published = await publishDraftMarket({ params: publishParams(), wallet });

    expect(published).toEqual({
      chainId: 31337,
      creator: ACCOUNT,
      marketId: "9",
      transactionHash: PUBLISH_HASH,
    });
    expect(clients.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        account: ACCOUNT,
        address: contractConfig.pregradManagerAddress,
        functionName: "createMarket",
        args: [
          expect.objectContaining({
            // The app adds only its configured collateral to the params.
            collateral: contractConfig.collateralAddress,
            graduationDeadline: 1_900_000_000n,
            metadataHash: METADATA_HASH,
            openingProbabilityWad: WAD / 2n,
          }),
        ],
        value: clients.creationFee,
      })
    );
  });
});

describe("persistPublishedMetadata", () => {
  it("posts the parsed metadata to the api and reports success as undefined", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ ok: true }, 200));
    vi.stubGlobal("fetch", fetcher);

    const syncError = await persistPublishedMetadata({
      chainId: 31337,
      metadataHash: METADATA_HASH,
      metadataPayload: '{"question":"Will it publish?"}',
    });

    expect(syncError).toBeUndefined();
    const [url, init] = fetcher.mock.calls[0] as unknown as Parameters<typeof fetch>;
    expect(url).toBe("/api/indexer/market-metadata");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      chainId: 31337,
      metadata: { question: "Will it publish?" },
      metadataHash: METADATA_HASH,
    });
  });

  it("returns the api's own error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "Indexer API is offline." }, 502))
    );

    await expect(
      persistPublishedMetadata({
        chainId: 31337,
        metadataHash: METADATA_HASH,
        metadataPayload: "{}",
      })
    ).resolves.toBe("Indexer API is offline.");
  });

  it("falls back to generic copy when the failure body is unreadable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not json", { status: 500 }))
    );

    await expect(
      persistPublishedMetadata({
        chainId: 31337,
        metadataHash: METADATA_HASH,
        metadataPayload: "{}",
      })
    ).resolves.toBe("Market metadata could not be saved to the API.");
  });

  it("falls back to generic copy when the failure body has no error field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({}, 500))
    );

    await expect(
      persistPublishedMetadata({
        chainId: 31337,
        metadataHash: METADATA_HASH,
        metadataPayload: "{}",
      })
    ).resolves.toBe("Market metadata could not be saved to the API.");
  });

  it("reports generic copy instead of throwing when the network fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Network unreachable.");
      })
    );

    await expect(
      persistPublishedMetadata({
        chainId: 31337,
        metadataHash: METADATA_HASH,
        metadataPayload: "{}",
      })
    ).resolves.toBe("Market metadata could not be saved to the API.");
  });
});

function publishParams(): MarketDraftPublishParams {
  return {
    bypassAiResolution: false,
    graduationDeadline: "1900000000",
    graduationThreshold: "2500000000000000000000",
    liquidityParameter: "5000000000000000000000",
    metadata: '{"question":"Will it publish?"}',
    metadataHash: METADATA_HASH,
    openingProbabilityWad: (WAD / 2n).toString(),
    resolutionTime: "1900600000",
    yesNotBefore: "1900600000",
  };
}

type MockClients = {
  balance: bigint;
  creationFee: bigint;
  creationLogs: ReturnType<typeof marketCreatedLog>[];
  getBalance: ReturnType<typeof vi.fn>;
  writeContract: ReturnType<typeof vi.fn>;
};

function mockWallet() {
  const clients: MockClients = {
    balance: 10n * WAD,
    creationFee: WAD,
    creationLogs: [marketCreatedLog()],
    getBalance: vi.fn(),
    writeContract: vi.fn(async () => PUBLISH_HASH),
  };

  clients.getBalance.mockImplementation(async () => clients.balance);

  const wallet: CreateMarketWallet = {
    accountAddress: ACCOUNT,
    activeChainId: 31337,
    publicClient: {
      getBalance: clients.getBalance,
      readContract: vi.fn(async () => clients.creationFee),
      waitForTransactionReceipt: vi.fn(async () => ({ logs: clients.creationLogs })),
    } as unknown as PublicClient,
    walletClient: {
      chain: undefined,
      writeContract: clients.writeContract,
    } as unknown as WalletClient,
  };

  return { clients, wallet };
}

// A genuinely ABI-encoded MarketCreated log so the real parseEventLogs
// decoding path runs against it.
function marketCreatedLog() {
  return {
    address: contractConfig.pregradManagerAddress,
    data: encodeAbiParameters(
      [
        { name: "metadata", type: "string" },
        { name: "collateral", type: "address" },
        { name: "openingProbabilityWad", type: "uint256" },
        { name: "liquidityParameter", type: "uint256" },
        { name: "graduationThreshold", type: "uint256" },
        { name: "graduationDeadline", type: "uint64" },
        { name: "resolutionTime", type: "uint64" },
        { name: "yesNotBefore", type: "uint64" },
        { name: "bypassAiResolution", type: "bool" },
      ],
      [
        "{}",
        contractConfig.collateralAddress,
        WAD / 2n,
        5_000n * WAD,
        2_500n * WAD,
        1_900_000_000n,
        1_900_600_000n,
        1_900_600_000n,
        false,
      ]
    ),
    topics: encodeEventTopics({
      abi: pregradManagerAbi,
      eventName: "MarketCreated",
      args: {
        creator: ACCOUNT,
        marketId: 9n,
        metadataHash: METADATA_HASH,
      },
    }),
  };
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}
