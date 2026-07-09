import { encodeAbiParameters, encodeEventTopics } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProtocolCreateMarketParams } from "@/domain/market-creation/types";
import type { PopChartsContractConfig } from "@/integrations/contracts/config";
import { getPopChartsContractConfig } from "@/integrations/contracts/config";
import { pregradManagerAbi } from "@/integrations/contracts/pregrad-manager";
import { serializeProtocolCreateMarketParams } from "@/integrations/contracts/protocol-params";

import { POST } from "./route";

vi.mock("@/integrations/contracts/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/integrations/contracts/config")>()),
  getPopChartsContractConfig: vi.fn(),
}));

const clientState = vi.hoisted(() => ({
  balance: 0n,
  creationFee: 0n,
  creationLogs: [] as unknown[],
  writeContract: undefined as unknown as import("vitest").Mock,
}));

vi.mock("viem", async (importOriginal) => {
  const original = await importOriginal<typeof import("viem")>();

  return {
    ...original,
    createPublicClient: () => ({
      getBalance: async () => clientState.balance,
      readContract: async () => clientState.creationFee,
      waitForTransactionReceipt: async () => ({ logs: clientState.creationLogs }),
    }),
    createWalletClient: () => ({ writeContract: clientState.writeContract }),
  };
});

// The first Hardhat dev account key; only used to derive an address locally.
const PRIVATE_KEY = "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const RELAY_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const CREATE_HASH = `0x${"cc".repeat(32)}` as const;
const WAD = 10n ** 18n;

const contractConfig: PopChartsContractConfig = {
  chainEnv: "local",
  chainId: 31337,
  collateralAddress: "0x0000000000000000000000000000000000000002",
  nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
  pregradManagerAddress: "0x0000000000000000000000000000000000000001",
  rpcUrl: "http://127.0.0.1:8545",
};

const protocolParams: ProtocolCreateMarketParams = {
  bypassAiResolution: false,
  collateral: "0x1111111111111111111111111111111111111111",
  graduationDeadline: 1_785_542_400n,
  graduationThreshold: 100n * WAD,
  liquidityParameter: 5_000n * WAD,
  metadata: '{"version":1}',
  metadataHash: `0x${"ab".repeat(32)}`,
  openingProbabilityWad: WAD / 2n,
  resolutionTime: 1_785_628_800n,
  yesNotBefore: 1_785_628_800n,
};

beforeEach(() => {
  vi.stubEnv("POPCHARTS_DEVCHAIN_ENABLED", "true");
  vi.stubEnv("POPCHARTS_DEVCHAIN_PRIVATE_KEY", `0x${PRIVATE_KEY}`);
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("NEXT_PUBLIC_POPCHARTS_CHAIN_ENV", "");
  vi.mocked(getPopChartsContractConfig).mockReturnValue(contractConfig);
  clientState.balance = 10n * WAD;
  clientState.creationFee = WAD;
  clientState.creationLogs = [marketCreatedLog()];
  clientState.writeContract = vi.fn(async () => CREATE_HASH);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("POST /api/devchain/markets", () => {
  describe("safety interlocks", () => {
    it("is disabled without the exact enable flag", async () => {
      vi.stubEnv("POPCHARTS_DEVCHAIN_ENABLED", "TRUE");

      const response = await POST(jsonRequest(requestBody()));

      expect(response.status).toBe(404);
      expect(((await response.json()) as { error: string }).error).toBe(
        "Devchain market creation is not enabled."
      );
    });

    it("stays disabled on Vercel production even when the flag is on", async () => {
      vi.stubEnv("VERCEL_ENV", "production");

      const response = await POST(jsonRequest(requestBody()));

      expect(response.status).toBe(404);
    });

    it("stays disabled when the chain env is production", async () => {
      vi.stubEnv("NEXT_PUBLIC_POPCHARTS_CHAIN_ENV", "production");

      const response = await POST(jsonRequest(requestBody()));

      expect(response.status).toBe(404);
    });
  });

  describe("configuration", () => {
    it("fails with 500 without a contract config", async () => {
      vi.mocked(getPopChartsContractConfig).mockReturnValue(null);

      const response = await POST(jsonRequest(requestBody()));

      expect(response.status).toBe(500);
      expect(((await response.json()) as { error: string }).error).toBe(
        "Devchain contract configuration is incomplete."
      );
    });

    it("fails with 500 without a relay private key", async () => {
      vi.stubEnv("POPCHARTS_DEVCHAIN_PRIVATE_KEY", "");

      const response = await POST(jsonRequest(requestBody()));

      expect(response.status).toBe(500);
    });

    it("hides the raw config error behind generic copy for a malformed private key", async () => {
      vi.stubEnv("POPCHARTS_DEVCHAIN_PRIVATE_KEY", "0x1234");

      const response = await POST(jsonRequest(requestBody()));

      await expectError(response, 400, "Could not create market.");
    });

    it("accepts a private key without the 0x prefix", async () => {
      vi.stubEnv("POPCHARTS_DEVCHAIN_PRIVATE_KEY", PRIVATE_KEY);

      const response = await POST(jsonRequest(requestBody()));

      expect(response.status).toBe(200);
    });
  });

  describe("request validation", () => {
    it("rejects bodies without protocol params", async () => {
      const response = await POST(jsonRequest({}));

      await expectError(response, 400, "Expected protocolParams object.");
    });

    it("rejects non-object bodies", async () => {
      const response = await POST(jsonRequest(42));

      await expectError(response, 400, "Expected protocolParams object.");
    });

    it("surfaces protocol param parse failures", async () => {
      const response = await POST(
        jsonRequest({
          protocolParams: {
            ...serializeProtocolCreateMarketParams(protocolParams),
            resolutionTime: "soon",
          },
        })
      );

      await expectError(response, 400, "Invalid resolutionTime.");
    });
  });

  describe("creation", () => {
    it("rejects creation when the relay balance cannot cover the fee", async () => {
      clientState.creationFee = 150n * WAD;
      clientState.balance = WAD / 2n;

      const response = await POST(jsonRequest(requestBody()));

      await expectError(
        response,
        400,
        "The devchain relay signer needs 150 native USDC to create this market. It has 0.50 available."
      );
      expect(clientState.writeContract).not.toHaveBeenCalled();
    });

    it("skips the balance check when creation is free", async () => {
      clientState.creationFee = 0n;
      clientState.balance = 0n;

      const response = await POST(jsonRequest(requestBody()));

      expect(response.status).toBe(200);
      expect(clientState.writeContract).toHaveBeenCalledWith(
        expect.objectContaining({ value: 0n })
      );
    });

    it("swaps the requested collateral for the configured token", async () => {
      await POST(jsonRequest(requestBody()));

      const call = clientState.writeContract.mock.calls[0]?.[0] as {
        args: [{ collateral: string }];
      };

      expect(call.args[0].collateral).toBe(contractConfig.collateralAddress);
    });

    it("fails with 502 when MarketCreated is not emitted", async () => {
      clientState.creationLogs = [];

      const response = await POST(jsonRequest(requestBody()));

      expect(response.status).toBe(502);
      expect(((await response.json()) as { error: string }).error).toBe(
        "Transaction succeeded but MarketCreated was not emitted."
      );
    });

    it("returns the created market details", async () => {
      const response = await POST(jsonRequest(requestBody()));
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(body).toEqual({
        creator: RELAY_ADDRESS,
        marketId: "9",
        transactionHash: CREATE_HASH,
      });
    });

    it("hides raw transaction failures behind generic copy", async () => {
      clientState.writeContract = vi.fn(async () => {
        throw new Error("nonce too low");
      });

      const response = await POST(jsonRequest(requestBody()));

      await expectError(response, 400, "Could not create market.");
    });

    it("reports generic copy for non-Error failures", async () => {
      clientState.writeContract = vi.fn(async () => {
        throw "rpc unreachable";
      });

      const response = await POST(jsonRequest(requestBody()));

      await expectError(response, 400, "Could not create market.");
    });

    it.each([["arc-testnet", "preview"]] as const)(
      "creates markets on %s and %s chain envs too",
      async (envA, envB) => {
        for (const chainEnv of [envA, envB]) {
          vi.mocked(getPopChartsContractConfig).mockReturnValue({
            ...contractConfig,
            chainEnv,
          });

          const response = await POST(jsonRequest(requestBody()));

          expect(response.status).toBe(200);
        }
      }
    );
  });
});

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
        creator: RELAY_ADDRESS,
        marketId: 9n,
        metadataHash: `0x${"ab".repeat(32)}` as const,
      },
    }),
  };
}

function requestBody() {
  return {
    metadata: { version: 1 },
    protocolParams: serializeProtocolCreateMarketParams(protocolParams),
  };
}

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/devchain/markets", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function expectError(response: Response, status: number, error: string) {
  expect(response.status).toBe(status);
  expect(((await response.json()) as { error: string }).error).toBe(error);
}
