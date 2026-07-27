import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  MARKET_COUNT_SELECTOR,
  formatChainId,
  isUint256Word,
} from "../shared/chain/pregradManagerProbe.ts";
import { readRpcPort } from "../shared/chain/staleStackRecovery.ts";
import { parseSmokeMarket } from "../shared/deployments/smokeMarket.ts";
import { readEnvFile } from "../shared/env/readEnvFile.ts";
import { resolveIndexerApiBaseUrl } from "../shared/env/resolveIndexerApiBaseUrl.ts";
import { parseLabeledJson } from "../shared/json/parseLabeledJson.ts";
import { buildProtocolCommandEnv } from "../shared/localMarket/buildProtocolCommandEnv.ts";
import {
  extractGeneratedMarketOptionKeyFromQuestion,
  filterUnusedGeneratedMarketOptions,
  generatedMarketOptionKey,
} from "../shared/localMarket/generatedMarketOptions.ts";
import { parseLocalCreateMarketArgs } from "../shared/localMarket/parseLocalCreateMarketArgs.ts";
import { deriveStackResources } from "../shared/localStack/ports.ts";
import { resolveProtocolChainEnv } from "../shared/localStack/protocolChainEnv.ts";

// A LOCAL_CHAIN_SMOKE_MARKET line as protocol/scripts/create-local-market.ts
// emits it (recorded from a real run, surrounded by typical pnpm/Hardhat
// noise). If the protocol helper stops emitting this shape, parseSmokeMarket
// must fail loudly instead of handing orchestrators partial data.
const MARKET_LINE =
  'LOCAL_CHAIN_SMOKE_MARKET={"blockNumber":"31","chainId":31337,' +
  '"collateralAddress":"0xc5a5C42992dECbae36851359345FE25997F5C42d",' +
  '"creator":"0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",' +
  '"graduationDeadline":"1783441959","marketId":"1","metadata":"{}",' +
  '"metadataHash":"0xf1076284dc0d6a361c6c853598cb6c4b2e5695fd2fa2545358df1bc403743944",' +
  '"pregradManagerAddress":"0x67d269191c92Caf3cD7723F116c85e6E9bf55933",' +
  '"resolutionTime":"1783445559","transactionHash":"0x82"}';
const MARKET_OUTPUT = [
  "> @popcharts/protocol@0.1.0 local:create-market /popcharts/protocol",
  "> hardhat run scripts/create-local-market.ts --network localhost",
  "",
  MARKET_LINE,
  "",
].join("\n");

describe("parseSmokeMarket", function () {
  it("extracts the fields orchestrators rely on from helper output", function () {
    assert.deepEqual(parseSmokeMarket(MARKET_OUTPUT), {
      chainId: 31337,
      marketId: "1",
      metadataHash:
        "0xf1076284dc0d6a361c6c853598cb6c4b2e5695fd2fa2545358df1bc403743944",
    });
  });

  it("rejects output without the marker line", function () {
    assert.throws(
      () => parseSmokeMarket("Compiled 1 contract\n"),
      /LOCAL_CHAIN_SMOKE_MARKET/,
    );
  });

  it("rejects payloads missing the fields it promises", function () {
    const withoutMarketId = MARKET_LINE.replace('"marketId":"1",', "");
    assert.throws(() => parseSmokeMarket(withoutMarketId), /marketId/);

    const stringChainId = MARKET_LINE.replace(
      '"chainId":31337',
      '"chainId":"31337"',
    );
    assert.throws(() => parseSmokeMarket(stringChainId), /chainId/);

    const truncatedHash = MARKET_LINE.replace(
      /"metadataHash":"0x[0-9a-f]+"/,
      '"metadataHash":"0xf107"',
    );
    assert.throws(() => parseSmokeMarket(truncatedHash), /metadataHash/);
  });
});

describe("parseLabeledJson", function () {
  it("finds the labeled line among unrelated output", function () {
    assert.deepEqual(
      parseLabeledJson('banner\nRESULT={"ok":true}\ntrailer', "RESULT"),
      { ok: true },
    );
  });

  it("throws when the label is absent", function () {
    assert.throws(() => parseLabeledJson("no marker here", "RESULT"), /RESULT/);
  });
});

describe("pregrad manager probe", function () {
  it("keeps the marketCount() selector in sync with the protocol", function () {
    // protocol/test/nodejs/create-local-market.test.ts asserts the same value
    // from the ABI side via toFunctionSelector. Both must change together.
    assert.equal(MARKET_COUNT_SELECTOR, "0xec979082");
  });

  it("accepts exactly one uint256 return word", function () {
    assert.equal(isUint256Word(`0x${"0".repeat(64)}`), true);
    assert.equal(isUint256Word("0x"), false);
    assert.equal(isUint256Word(`0x${"0".repeat(63)}`), false);
    assert.equal(isUint256Word(undefined), false);
    assert.equal(isUint256Word(31337), false);
  });

  it("formats chain IDs for error messages", function () {
    assert.equal(formatChainId("0x7a69"), "31337 (0x7a69)");
    assert.equal(formatChainId("not-hex"), "not-hex");
    assert.equal(formatChainId(undefined), "undefined");
  });
});

describe("resolveIndexerApiBaseUrl", function () {
  it("prefers the explicit CLI value, then env overrides, then the port", function () {
    const env = {
      NEXT_PUBLIC_POPCHARTS_INDEXER_API_URL: "http://next-public:1",
      POPCHARTS_INDEXER_API_URL: "http://direct:2",
      PORT: "4001",
    };

    assert.equal(resolveIndexerApiBaseUrl("http://cli:9", env), "http://cli:9");
    assert.equal(resolveIndexerApiBaseUrl(undefined, env), "http://direct:2");
    assert.equal(
      resolveIndexerApiBaseUrl(undefined, {
        NEXT_PUBLIC_POPCHARTS_INDEXER_API_URL: "http://next-public:1",
      }),
      "http://next-public:1",
    );
    assert.equal(
      resolveIndexerApiBaseUrl(undefined, {
        LOCAL_API_PORT: "3005",
        PORT: "4001",
      }),
      "http://127.0.0.1:3005",
    );
    assert.equal(
      resolveIndexerApiBaseUrl(undefined, { PORT: "4001" }),
      "http://127.0.0.1:4001",
    );
    assert.equal(
      resolveIndexerApiBaseUrl(undefined, {}),
      "http://127.0.0.1:3001",
    );
    assert.equal(
      resolveIndexerApiBaseUrl(undefined, { POPCHARTS_STACK_SLOT: "2" }),
      "http://127.0.0.1:3021",
    );
  });
});

describe("generated local market option de-duping", function () {
  const subjects = {
    crypto: [
      { key: "bitcoin", symbol: "BTC" },
      { key: "ethereum", symbol: "ETH" },
    ],
    weather: [
      { city: "NYC", key: "KNYC" },
      { city: "San Francisco", key: "KSFO" },
    ],
  } as const;

  it("recognizes generated crypto and weather questions as stable option keys", function () {
    assert.equal(
      extractGeneratedMarketOptionKeyFromQuestion(
        "Will BTC/USD be higher than $63,000 at 2026-07-07T17:00:00Z?",
        subjects,
      ),
      generatedMarketOptionKey("crypto", "bitcoin", "higher"),
    );

    assert.equal(
      extractGeneratedMarketOptionKeyFromQuestion(
        "Will the max San Francisco METAR temperature be lower than 67°F by 2026-07-07T17:00:00Z?",
        subjects,
      ),
      generatedMarketOptionKey("weather", "KSFO", "lower"),
    );

    assert.equal(
      extractGeneratedMarketOptionKeyFromQuestion(
        "Will a hand-written market render?",
        subjects,
      ),
      null,
    );
  });

  it("removes used options until every option has been exhausted", function () {
    const options = [
      { key: generatedMarketOptionKey("crypto", "bitcoin", "higher") },
      { key: generatedMarketOptionKey("crypto", "bitcoin", "lower") },
    ] as const;

    assert.deepEqual(
      filterUnusedGeneratedMarketOptions(
        options,
        new Set([generatedMarketOptionKey("crypto", "bitcoin", "higher")]),
      ),
      {
        exhausted: false,
        options: [options[1]],
        totalCount: 2,
        unusedCount: 1,
      },
    );

    assert.deepEqual(
      filterUnusedGeneratedMarketOptions(
        options,
        new Set(options.map((option) => option.key)),
      ),
      {
        exhausted: true,
        options,
        totalCount: 2,
        unusedCount: 0,
      },
    );
  });
});

describe("readEnvFile", function () {
  it("parses the generated local-chain env file format", function () {
    const dir = mkdtempSync(join(tmpdir(), "popcharts-env-"));
    const file = join(dir, ".env.local-chain");
    writeFileSync(
      file,
      [
        "# Generated by scripts/local-dev-control.ts.",
        "",
        "RPC_HTTP_URL=http://127.0.0.1:8545",
        "PREGRAD_MANAGER_ADDRESS=0xe7f1725e7734ce288f8367e1bb143e90bb3f0512",
        "EQUALS_IN_VALUE=a=b",
        "not-a-pair",
        "PREGRAD_MANAGER_ADDRESS=0x1111111111111111111111111111111111111111",
      ].join("\n"),
    );

    assert.deepEqual(readEnvFile(file), {
      RPC_HTTP_URL: "http://127.0.0.1:8545",
      PREGRAD_MANAGER_ADDRESS: "0x1111111111111111111111111111111111111111",
      EQUALS_IN_VALUE: "a=b",
    });
  });
});

describe("local-create-market CLI", function () {
  it("parses --stack and falls back to POPCHARTS_STACK", function () {
    assert.equal(parseLocalCreateMarketArgs(["--stack", "2"]).stack, "2");
    assert.equal(
      parseLocalCreateMarketArgs(["--stack=feature-stack"]).stack,
      "feature-stack",
    );
    assert.equal(
      parseLocalCreateMarketArgs([], { POPCHARTS_STACK: "env-stack" }).stack,
      "env-stack",
    );
    assert.equal(
      parseLocalCreateMarketArgs(["--stack", "cli-stack"], {
        POPCHARTS_STACK: "env-stack",
      }).stack,
      "cli-stack",
    );
  });
});

describe("local-create-market stale-stack recovery hint", function () {
  // The hint names a port for `lsof`. Naming the wrong one is how the original
  // incident misdirected a developer to the human stack's chain, so a URL that
  // does not describe :8545 must never produce it.
  it("names the port the RPC URL actually addresses", function () {
    assert.equal(readRpcPort("http://127.0.0.1:8555"), "8555");
    assert.equal(readRpcPort("http://127.0.0.1:8545"), "8545");
    assert.equal(readRpcPort("http://example.test"), "80");
    assert.equal(readRpcPort("https://example.test"), "443");
    assert.equal(readRpcPort("wss://example.test"), "443");
  });

  it("falls back to the local chain port only when the URL is unparseable", function () {
    assert.equal(readRpcPort("not a url"), "8545");
  });
});

describe("local-create-market protocol chain env", function () {
  // A StackDescriptor carries more than the resolver reads; only `slot` is
  // load-bearing here, since every other resource derives from it.
  const stackOnSlot = (slot: number) =>
    ({ slot }) as unknown as Parameters<typeof resolveProtocolChainEnv>[1];

  // Regression: the spawned `pnpm --dir protocol run local:create-market`
  // resolves its chain from POPCHARTS_LOCAL_RPC_URL (hardhat's `localhost`
  // network) and POPCHARTS_RPC_URL (the protocol scripts' viem clients), both
  // of which default to slot 0's :8545. Leaving them unset made every non-zero
  // slot create its market on the slot 0 chain while reporting success against
  // the resolved slot's API.
  it("pins the chain variables to the resolved slot's RPC URL", function () {
    assert.deepEqual(resolveProtocolChainEnv({}, stackOnSlot(1)), {
      POPCHARTS_LOCAL_RPC_URL: "http://127.0.0.1:8555",
      POPCHARTS_RPC_URL: "http://127.0.0.1:8555",
      RPC_HTTP_URL: "http://127.0.0.1:8555",
    });

    assert.equal(
      resolveProtocolChainEnv({}, stackOnSlot(2)).POPCHARTS_LOCAL_RPC_URL,
      deriveStackResources(2).chainRpcHttpUrl,
    );
  });

  it("lets the resolved slot outrank anything inherited from the shell", function () {
    // The slot owns its chain port, so a stale export from another slot's
    // shell — including the POPCHARTS_LOCAL_RPC_URL workaround for this very
    // bug — must not redirect the run.
    assert.deepEqual(
      resolveProtocolChainEnv(
        {
          POPCHARTS_LOCAL_RPC_URL: "http://127.0.0.1:8545",
          POPCHARTS_RPC_URL: "http://127.0.0.1:8545",
          RPC_HTTP_URL: "http://127.0.0.1:8545",
        },
        stackOnSlot(1),
      ),
      {
        POPCHARTS_LOCAL_RPC_URL: "http://127.0.0.1:8555",
        POPCHARTS_RPC_URL: "http://127.0.0.1:8555",
        RPC_HTTP_URL: "http://127.0.0.1:8555",
      },
    );
  });

  it("uses the env file's RPC URL when the registry was bypassed", function () {
    // `--local-chain-env` / `--api-url` skip registry resolution, so the env
    // file is authoritative and an explicit override backstops it.
    assert.equal(
      resolveProtocolChainEnv(
        {
          POPCHARTS_LOCAL_RPC_URL: "http://127.0.0.1:8565",
          RPC_HTTP_URL: "http://127.0.0.1:8575",
        },
        undefined,
      ).POPCHARTS_LOCAL_RPC_URL,
      "http://127.0.0.1:8575",
    );

    assert.equal(
      resolveProtocolChainEnv(
        { POPCHARTS_LOCAL_RPC_URL: "http://127.0.0.1:8565" },
        undefined,
      ).POPCHARTS_LOCAL_RPC_URL,
      "http://127.0.0.1:8565",
    );
  });

  it("falls back to slot 0 only when nothing else identifies a chain", function () {
    assert.deepEqual(resolveProtocolChainEnv({}, undefined), {
      POPCHARTS_LOCAL_RPC_URL: "http://127.0.0.1:8545",
      POPCHARTS_RPC_URL: "http://127.0.0.1:8545",
      RPC_HTTP_URL: "http://127.0.0.1:8545",
    });
  });

  // Resolving the chain correctly is worthless if the value never reaches the
  // spawned child — that gap *was* the bug. This asserts the environment the
  // protocol helper is actually handed, so dropping the pin fails here even
  // though the resolver above would still pass.
  it("hands the spawned protocol helper the resolved chain, not slot 0's", function () {
    const generatedMarket = {
      graduationSeconds: 3600,
      kind: "crypto",
      metadata: {
        category: "Crypto",
        createdAt: "2026-07-25T00:00:00Z",
        description: "d",
        question: "Will BTC/USD be higher than $1 at 2026-07-25T02:00:00Z?",
        resolutionCriteria: "c",
        version: 1,
      },
      resolutionSeconds: 7200,
    } as Parameters<typeof buildProtocolCommandEnv>[0]["generatedMarket"];

    const spawnEnv = buildProtocolCommandEnv({
      baseEnv: {
        POPCHARTS_LOCAL_RPC_URL: "http://127.0.0.1:8545",
        POPCHARTS_RPC_URL: "http://127.0.0.1:8545",
        RPC_HTTP_URL: "http://127.0.0.1:8545",
      },
      chainEnv: resolveProtocolChainEnv({}, stackOnSlot(1)),
      generatedMarket,
    });

    assert.equal(spawnEnv.POPCHARTS_LOCAL_RPC_URL, "http://127.0.0.1:8555");
    assert.equal(spawnEnv.POPCHARTS_RPC_URL, "http://127.0.0.1:8555");
    assert.equal(spawnEnv.RPC_HTTP_URL, "http://127.0.0.1:8555");
    assert.equal(spawnEnv.LOCAL_MARKET_GRADUATION_SECONDS, "3600");
    assert.equal(spawnEnv.LOCAL_MARKET_RESOLUTION_SECONDS, "7200");
    assert.match(
      String(spawnEnv.LOCAL_MARKET_METADATA),
      /"question":"Will BTC\/USD be higher than \$1/,
    );
  });
});
