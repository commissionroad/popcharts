import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, describe, it } from "node:test";

import {
  mineOnWallClock,
  WALL_CLOCK_BLOCK_INTERVAL_MS,
} from "../shared/chain/mineOnWallClock.ts";

let server: Server;
let rpcUrl: string;
let received: unknown[] = [];
let reply: unknown = { id: 1, jsonrpc: "2.0", result: true };

before(async function () {
  server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      received.push(JSON.parse(body));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(reply));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  rpcUrl = `http://127.0.0.1:${address.port}`;
});

after(async function () {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe("mineOnWallClock", function () {
  it("turns on one-second interval mining", async function () {
    received = [];
    reply = { id: 1, jsonrpc: "2.0", result: true };

    await mineOnWallClock(rpcUrl);

    assert.equal(WALL_CLOCK_BLOCK_INTERVAL_MS, 1_000);
    assert.deepEqual(received, [
      {
        id: 1,
        jsonrpc: "2.0",
        method: "evm_setIntervalMining",
        params: [1_000],
      },
    ]);
  });

  it("leaves a chain without the evm namespace alone", async function () {
    reply = {
      error: { code: -32601, message: "Method not found" },
      id: 1,
      jsonrpc: "2.0",
    };

    await mineOnWallClock(rpcUrl);
  });

  it("fails loudly on any other RPC error", async function () {
    reply = {
      error: { code: -32603, message: "Internal error" },
      id: 1,
      jsonrpc: "2.0",
    };

    await assert.rejects(
      mineOnWallClock(rpcUrl),
      /evm_setIntervalMining failed on .*: Internal error/,
    );
  });
});
