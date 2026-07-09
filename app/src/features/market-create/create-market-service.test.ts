import type { PublicClient, WalletClient } from "viem";
import { encodeAbiParameters, encodeEventTopics } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createInitialMarketDraft } from "@/domain/market-creation/create-market";
import type {
  MarketCreationMode,
  MarketCreationSigner,
  PopChartsContractConfig,
} from "@/integrations/contracts/config";
import { pregradManagerAbi } from "@/integrations/contracts/pregrad-manager";

import {
  createMarket,
  type CreateMarketWallet,
  createMockMarket,
  submitMarketForReview,
} from "./create-market-service";

const configState = vi.hoisted(() => ({
  config: null as unknown,
  mode: "mock" as string,
  // When non-empty, each config read consumes the next queued value so tests
  // can vary what consecutive getPopChartsContractConfig calls observe.
  queue: [] as unknown[],
  signer: "wallet" as string,
}));

vi.mock("@/integrations/contracts/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/integrations/contracts/config")>()),
  getPopChartsContractConfig: () =>
    configState.queue.length > 0 ? configState.queue.shift() : configState.config,
  get marketCreationMode() {
    return configState.mode;
  },
  get marketCreationSigner() {
    return configState.signer;
  },
}));

const WAD = 10n ** 18n;
const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const CREATE_HASH = `0x${"cc".repeat(32)}` as const;

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
  vi.useRealTimers();
  configState.config = null;
  configState.mode = "mock";
  configState.queue = [];
  configState.signer = "wallet";
});

describe("createMockMarket", () => {
  it("rejects invalid drafts", async () => {
    await expect(createMockMarket(invalidDraft())).rejects.toThrow(
      "Cannot create an invalid market draft."
    );
  });

  it("derives a mock market from the draft preview", async () => {
    vi.useFakeTimers();

    const creation = createMockMarket(validDraft());

    await vi.advanceTimersByTimeAsync(200);
    const market = await creation;

    expect(market.creationMode).toBe("mock");
    expect(market.marketId).toBe(`draft-${market.metadataHash.slice(2, 8)}`);
    expect(market.metadata.question).toBe("Will the review queue accept this market?");
  });
});

describe("createMarket", () => {
  it("creates a mock market when no devchain is configured", async () => {
    vi.useFakeTimers();

    const creation = createMarket(validDraft());

    await vi.advanceTimersByTimeAsync(200);

    expect((await creation).creationMode).toBe("mock");
  });

  it("rejects invalid drafts before touching the chain", async () => {
    devchain("wallet");

    await expect(createMarket(invalidDraft())).rejects.toThrow(
      "Cannot create an invalid market draft."
    );
  });

  it("fails fast when the contract configuration is incomplete", async () => {
    devchain("wallet");
    configState.config = null;

    await expect(createMarket(validDraft())).rejects.toThrow(
      "Devchain contract configuration is incomplete."
    );
  });

  describe("with the server relay signer", () => {
    it("creates the market and syncs metadata", async () => {
      devchain("server");
      const fetcher = stubFetch({
        "/api/devchain/markets": () =>
          jsonResponse({ marketId: "7", transactionHash: CREATE_HASH }, 200),
        "/api/indexer/market-metadata": () => jsonResponse({ ok: true }, 200),
      });

      const market = await createMarket(validDraft());

      expect(market.creationMode).toBe("devchain");
      expect(market.creationSigner).toBe("server");
      expect(market.chainId).toBe(31337);
      expect(market.marketId).toBe("7");
      expect(market.transactionHash).toBe(CREATE_HASH);
      expect(market.metadataSyncError).toBeUndefined();

      const creationBody = requestBody(fetcher, "/api/devchain/markets");
      const protocolParams = creationBody.protocolParams as Record<string, unknown>;

      // The chain preview swaps the draft collateral for the configured token.
      expect(protocolParams.collateral).toBe(contractConfig.collateralAddress);
    });

    it("surfaces the relay's error message", async () => {
      devchain("server");
      stubFetch({
        "/api/devchain/markets": () =>
          jsonResponse({ error: "Relay signer unavailable." }, 503),
      });

      await expect(createMarket(validDraft())).rejects.toThrow(
        "Relay signer unavailable."
      );
    });

    it("falls back to generic copy when the relay omits transaction details", async () => {
      devchain("server");
      stubFetch({
        "/api/devchain/markets": () => jsonResponse({ marketId: "7" }, 200),
      });

      await expect(createMarket(validDraft())).rejects.toThrow(
        "The devchain creation service failed."
      );
    });

    it("reports a metadata sync failure without failing the creation", async () => {
      devchain("server");
      stubFetch({
        "/api/devchain/markets": () =>
          jsonResponse({ marketId: "7", transactionHash: CREATE_HASH }, 200),
        "/api/indexer/market-metadata": () =>
          jsonResponse({ error: "Indexer API is offline." }, 502),
      });

      const market = await createMarket(validDraft());

      expect(market.marketId).toBe("7");
      expect(market.metadataSyncError).toBe("Indexer API is offline.");
    });

    it("reports a generic sync error when the failure body is unreadable", async () => {
      devchain("server");
      stubFetch({
        "/api/devchain/markets": () =>
          jsonResponse({ marketId: "7", transactionHash: CREATE_HASH }, 200),
        "/api/indexer/market-metadata": () => new Response("not json", { status: 500 }),
      });

      const market = await createMarket(validDraft());

      expect(market.metadataSyncError).toBe(
        "Market metadata could not be saved to the API."
      );
    });

    it("reports generic copy (not the raw error) when the metadata sync throws", async () => {
      devchain("server");
      stubFetch({
        "/api/devchain/markets": () =>
          jsonResponse({ marketId: "7", transactionHash: CREATE_HASH }, 200),
        "/api/indexer/market-metadata": () => {
          throw new Error("Network unreachable.");
        },
      });

      const market = await createMarket(validDraft());

      expect(market.metadataSyncError).toBe(
        "Market metadata could not be saved to the API."
      );
    });

    it("reports generic copy when the sync fails with a non-Error value", async () => {
      devchain("server");
      stubFetch({
        "/api/devchain/markets": () =>
          jsonResponse({ marketId: "7", transactionHash: CREATE_HASH }, 200),
        "/api/indexer/market-metadata": () => {
          throw "offline";
        },
      });

      const market = await createMarket(validDraft());

      expect(market.metadataSyncError).toBe(
        "Market metadata could not be saved to the API."
      );
    });
  });

  describe("with the wallet signer", () => {
    it("requires a connected wallet", async () => {
      devchain("wallet");

      await expect(createMarket(validDraft())).rejects.toThrow(
        "Connect a wallet before creating a devchain market."
      );
    });

    it("fails when the configuration disappears mid-creation", async () => {
      devchain("wallet");
      configState.queue = [configState.config, null];
      const { wallet } = mockWallet();

      await expect(createMarket(validDraft(), { wallet })).rejects.toThrow(
        "Devchain contract configuration is incomplete."
      );
    });

    it("requires the wallet to be on the devchain", async () => {
      devchain("wallet");
      const { wallet } = mockWallet();
      wallet.activeChainId = 1;

      await expect(createMarket(validDraft(), { wallet })).rejects.toThrow(
        "Switch your wallet to chain 31337 before creating."
      );
    });

    it("rejects creation when the balance cannot cover the creation fee", async () => {
      devchain("wallet");
      const { clients, wallet } = mockWallet();
      clients.creationFee = (15n * WAD) / 10n;
      clients.balance = WAD / 2n;

      await expect(createMarket(validDraft(), { wallet })).rejects.toThrow(
        "Public market creation costs 1.50 native USDC. Your wallet has 0.50 available."
      );
      expect(clients.writeContract).not.toHaveBeenCalled();
    });

    it("formats large fees without cents and empty balances without decimals", async () => {
      devchain("wallet");
      const { clients, wallet } = mockWallet();
      clients.creationFee = 150n * WAD;
      clients.balance = 0n;

      await expect(createMarket(validDraft(), { wallet })).rejects.toThrow(
        "Public market creation costs 150 native USDC. Your wallet has 0 available."
      );
    });

    it("skips the balance check when creation is free", async () => {
      devchain("wallet");
      stubFetch({
        "/api/indexer/market-metadata": () => jsonResponse({ ok: true }, 200),
      });
      const { clients, wallet } = mockWallet();
      clients.creationFee = 0n;

      await createMarket(validDraft(), { wallet });

      expect(clients.getBalance).not.toHaveBeenCalled();
      expect(clients.writeContract).toHaveBeenCalledWith(
        expect.objectContaining({ functionName: "createMarket", value: 0n })
      );
    });

    it("fails when the transaction confirms without a MarketCreated event", async () => {
      devchain("wallet");
      const { clients, wallet } = mockWallet();
      clients.creationLogs = [];

      await expect(createMarket(validDraft(), { wallet })).rejects.toThrow(
        "Transaction succeeded but MarketCreated was not emitted."
      );
    });

    it("reports a metadata sync failure without failing the creation", async () => {
      devchain("wallet");
      stubFetch({
        "/api/indexer/market-metadata": () =>
          jsonResponse({ error: "Indexer API is offline." }, 502),
      });
      const { wallet } = mockWallet();

      const market = await createMarket(validDraft(), { wallet });

      expect(market.marketId).toBe("9");
      expect(market.metadataSyncError).toBe("Indexer API is offline.");
    });

    it("maps the confirmed event into the created market", async () => {
      devchain("wallet");
      stubFetch({
        "/api/indexer/market-metadata": () => jsonResponse({ ok: true }, 200),
      });
      const { clients, wallet } = mockWallet();

      const market = await createMarket(validDraft(), { wallet });

      expect(market.creationMode).toBe("devchain");
      expect(market.creationSigner).toBe("wallet");
      expect(market.creator).toBe(ACCOUNT);
      expect(market.marketId).toBe("9");
      expect(market.transactionHash).toBe(CREATE_HASH);
      expect(market.metadataSyncError).toBeUndefined();
      expect(clients.writeContract).toHaveBeenCalledWith(
        expect.objectContaining({ value: clients.creationFee })
      );
    });
  });
});

describe("submitMarketForReview", () => {
  it("rejects invalid drafts before submitting", async () => {
    await expect(submitMarketForReview(invalidDraft())).rejects.toThrow(
      "Cannot submit an invalid market draft."
    );
  });

  it("submits a serialized market preview for review", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse(
        {
          aiReview: {
            source: "local",
            status: "eligible",
          },
          reviewId: "review-test-123",
          status: "queued",
          submittedAt: "2026-06-22T12:00:00.000Z",
        },
        202
      )
    );
    vi.stubGlobal("fetch", fetcher);

    const result = await submitMarketForReview(validDraft());
    const [input, init] = firstFetchCall(fetcher);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const protocolParams = body.protocolParams as Record<string, unknown>;
    const metadata = body.metadata as Record<string, unknown>;

    expect(input).toBe("/api/market-review/submissions");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ "content-type": "application/json" });
    expect(metadata.question).toBe("Will the review queue accept this market?");
    expect(protocolParams.metadata).toContain('"version":1');
    expect(protocolParams.graduationDeadline).toMatch(/^\d+$/);
    expect(protocolParams.openingProbabilityWad).toBe("500000000000000000");
    expect(body.metadataHash).toBe(protocolParams.metadataHash);
    expect(result.reviewId).toBe("review-test-123");
    expect(result.reviewStatus).toBe("queued");
    expect(result.aiReview).toEqual({
      source: "local",
      status: "eligible",
    });
  });

  it("surfaces review submission errors", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ error: "Reviewer queue is unavailable." }, 503)
    );
    vi.stubGlobal("fetch", fetcher);

    await expect(submitMarketForReview(validDraft())).rejects.toThrow(
      "Reviewer queue is unavailable."
    );
  });

  it("falls back to generic copy when the failure body is unreadable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("gateway timeout", { status: 504 }))
    );

    await expect(submitMarketForReview(validDraft())).rejects.toThrow(
      "The review submission service could not submit this market."
    );
  });

  it("rejects accepted responses that are missing the review ticket", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ status: "queued" }, 202))
    );

    await expect(submitMarketForReview(validDraft())).rejects.toThrow(
      "The review submission service could not submit this market."
    );
  });

  it("accepts webhook-forwarded review tickets", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          {
            aiReview: { source: "webhook", status: "forwarded" },
            reviewId: "review-webhook-1",
            status: "queued",
            submittedAt: "2026-06-22T12:00:00.000Z",
          },
          202
        )
      )
    );

    const result = await submitMarketForReview(validDraft());

    expect(result.aiReview).toEqual({ source: "webhook", status: "forwarded" });
  });
});

function devchain(signer: MarketCreationSigner) {
  configState.config = contractConfig;
  configState.mode = "devchain" satisfies MarketCreationMode;
  configState.signer = signer;
}

function validDraft() {
  return {
    ...createInitialMarketDraft(new Date("2030-07-01T12:00:00.000Z")),
    question: "Will the review queue accept this market?",
    resolutionCriteria: "Resolves YES if the review submission endpoint accepts it.",
  };
}

function invalidDraft() {
  return {
    ...createInitialMarketDraft(new Date("2030-07-01T12:00:00.000Z")),
    question: "",
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
    writeContract: vi.fn(async () => CREATE_HASH),
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
        100n * WAD,
        1n,
        2n,
        2n,
        false,
      ]
    ),
    topics: encodeEventTopics({
      abi: pregradManagerAbi,
      eventName: "MarketCreated",
      args: {
        creator: ACCOUNT,
        marketId: 9n,
        metadataHash: `0x${"11".repeat(32)}` as const,
      },
    }),
  };
}

function stubFetch(routes: Record<string, () => Response>) {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const route = routes[url];

    if (!route) {
      throw new Error(`Unexpected fetch: ${url}`);
    }

    return route();
  });

  vi.stubGlobal("fetch", fetcher);

  return fetcher;
}

function requestBody(fetcher: ReturnType<typeof vi.fn>, url: string) {
  const call = fetcher.mock.calls.find(([input]) => String(input) === url) as
    | Parameters<typeof fetch>
    | undefined;

  if (!call) {
    throw new Error(`Expected a fetch call to ${url}.`);
  }

  return JSON.parse(String(call[1]?.body)) as Record<string, unknown>;
}

function firstFetchCall(fetcher: ReturnType<typeof vi.fn>) {
  const call = fetcher.mock.calls[0] as Parameters<typeof fetch> | undefined;

  if (!call) {
    throw new Error("Expected fetch to be called.");
  }

  return call;
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}
