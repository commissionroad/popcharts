import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { type PregradDeploy } from "../shared/deployments/pregradDeploy.ts";
import { buildLocalAppEnv } from "../shared/env/buildLocalAppEnv.ts";

const DEPLOY: PregradDeploy = {
  chainId: 31337,
  collateralAddress: "0x0000000000000000000000000000000000000c01",
  deployBlock: "42",
  postgradAdapterAddress: "0x0000000000000000000000000000000000000ada",
  pregradManagerAddress: "0x0000000000000000000000000000000000000b01",
};

describe("buildLocalAppEnv", function () {
  const env = buildLocalAppEnv({
    apiBaseUrl: "http://127.0.0.1:3011",
    deploy: DEPLOY,
    postgrad: null,
    rpcHttpUrl: "http://127.0.0.1:8545",
  });

  // Regression guard for repo ADR 0021: the live-updates SSE connection runs in
  // the browser and can only read NEXT_PUBLIC_* vars. When this spelling was
  // missing, every local market page's live connection was silently inert —
  // baseUrl undefined, no socket, no refresh — while server-side reads still
  // worked off the non-public var, so nothing failed loudly. Both must point at
  // the API for a page to go live locally.
  it("exposes the indexer API url to the browser and to the server", function () {
    assert.equal(
      env.NEXT_PUBLIC_POPCHARTS_INDEXER_API_URL,
      "http://127.0.0.1:3011",
    );
    assert.equal(env.POPCHARTS_INDEXER_API_URL, "http://127.0.0.1:3011");
  });
});
