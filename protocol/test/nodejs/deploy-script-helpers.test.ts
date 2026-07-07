import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizePrivateKey } from "../../scripts/shared/account/normalizePrivateKey.js";
import { formatMissingAccountMessage } from "../../scripts/shared/cli/initializeScriptEnvironment.js";
import { contractExplorerUrl } from "../../scripts/shared/explorer/contractExplorerUrl.js";
import { normalizeExplorerMessage } from "../../scripts/shared/explorer/normalizeExplorerMessage.js";
import { parseExplorerJson } from "../../scripts/shared/json/parseExplorerJson.js";

const VALID_KEY_BODY = "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

describe("deploy script helpers", function () {
  describe("normalizePrivateKey", function () {
    it("accepts prefixed keys and adds the 0x prefix to bare keys", function () {
      assert.equal(normalizePrivateKey(`0x${VALID_KEY_BODY}`), `0x${VALID_KEY_BODY}`);
      assert.equal(normalizePrivateKey(VALID_KEY_BODY), `0x${VALID_KEY_BODY}`);
    });

    it("names the env var in errors without echoing the value", function () {
      assert.throws(
        () => normalizePrivateKey(undefined, { label: "POPCHARTS_DEPLOYER_PRIVATE_KEY" }),
        /Expected POPCHARTS_DEPLOYER_PRIVATE_KEY to be set\./,
      );
      assert.throws(
        () => normalizePrivateKey("0x1234", { label: "POPCHARTS_DEPLOYER_PRIVATE_KEY" }),
        (error: unknown) =>
          error instanceof Error &&
          error.message === "Expected POPCHARTS_DEPLOYER_PRIVATE_KEY to be a 32-byte hex key.",
      );
    });
  });

  describe("parseExplorerJson", function () {
    it("returns the explorer response envelope", function () {
      assert.deepEqual(
        parseExplorerJson({ label: "ArcScan", text: '{"status":"1","result":"guid"}' }),
        {
          result: "guid",
          status: "1",
        },
      );
    });

    it("rejects non-JSON and non-object payloads with the explorer name", function () {
      assert.throws(
        () => parseExplorerJson({ label: "ArcScan", text: "<html>" }),
        /ArcScan returned non-JSON response: <html>/,
      );
      assert.throws(
        () => parseExplorerJson({ label: "ArcScan", text: '"just a string"' }),
        /ArcScan returned an unexpected JSON payload/,
      );
    });
  });

  describe("normalizeExplorerMessage", function () {
    it("passes strings through and stringifies structured results", function () {
      assert.equal(normalizeExplorerMessage("Pass - Verified"), "Pass - Verified");
      assert.equal(normalizeExplorerMessage({ error: "rate limited" }), '{"error":"rate limited"}');
    });
  });

  describe("formatMissingAccountMessage", function () {
    it("keeps the exact per-role wording scripts printed before the shared preamble", function () {
      assert.equal(
        formatMissingAccountMessage({ accountRole: "deployer", networkName: "localhost" }),
        "Expected Hardhat network localhost to expose a deployer account. " +
          "Set POPCHARTS_DEPLOYER_PRIVATE_KEY.",
      );
      assert.equal(
        formatMissingAccountMessage({ accountRole: "keeper", networkName: "arcTestnet" }),
        "Expected Hardhat network arcTestnet to expose a keeper account. " +
          "Set POPCHARTS_DEPLOYER_PRIVATE_KEY.",
      );
      assert.equal(
        formatMissingAccountMessage({ accountRole: "smoke", networkName: "arcTestnet" }),
        "Expected Hardhat network arcTestnet to expose a smoke account. " +
          "Set POPCHARTS_DEPLOYER_PRIVATE_KEY.",
      );
    });
  });

  describe("contractExplorerUrl", function () {
    it("joins base URL, route, and address without duplicate slashes", function () {
      assert.equal(
        contractExplorerUrl({
          address: "0x0000000000000000000000000000000000000001",
          browserUrl: "https://testnet.arcscan.app/",
        }),
        "https://testnet.arcscan.app/address/0x0000000000000000000000000000000000000001",
      );
      assert.equal(
        contractExplorerUrl({
          address: "0x0000000000000000000000000000000000000001",
          addressPath: "/token/",
          browserUrl: "https://testnet.arcscan.app",
        }),
        "https://testnet.arcscan.app/token/0x0000000000000000000000000000000000000001",
      );
    });
  });
});
