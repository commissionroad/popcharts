import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, describe, it } from "node:test";

import {
  JsonRpcTransportError,
  postJsonRpc,
} from "../shared/chain/postJsonRpc.ts";
import { sendLocalRpcRequest } from "../shared/chain/localRpcRequest.ts";

// A port nothing is listening on. 1 is privileged and never a devchain, so a
// connection there fails at the transport layer without racing a real server.
const unreachableRpcUrl = "http://127.0.0.1:1";

let server: Server;
let rpcUrl: string;
let respond: (request: { body: string }) => {
  body: string;
  status: number;
} = () => ({
  body: JSON.stringify({ id: 1, jsonrpc: "2.0", result: "0x7a69" }),
  status: 200,
});

before(async function () {
  server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const reply = respond({ body });
      response.writeHead(reply.status, { "content-type": "application/json" });
      response.end(reply.body);
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

describe("postJsonRpc", function () {
  it("sends a well-formed JSON-RPC body and returns the envelope", async function () {
    let received = "";
    respond = ({ body }) => {
      received = body;
      return {
        body: JSON.stringify({ id: 1, jsonrpc: "2.0", result: "0x7a69" }),
        status: 200,
      };
    };

    const response = await postJsonRpc({
      method: "eth_getCode",
      params: ["0xabc", "latest"],
      rpcUrl,
    });

    assert.deepEqual(JSON.parse(received), {
      id: 1,
      jsonrpc: "2.0",
      method: "eth_getCode",
      params: ["0xabc", "latest"],
    });
    assert.equal(response.result, "0x7a69");
  });

  it("returns a JSON-RPC error as data rather than throwing", async function () {
    // Probing whether a contract answers treats an error as the answer, so
    // this layer must not decide it is a failure.
    respond = () => ({
      body: JSON.stringify({
        error: { message: "execution reverted" },
        id: 1,
        jsonrpc: "2.0",
      }),
      status: 200,
    });

    const response = await postJsonRpc({
      method: "eth_call",
      params: [],
      rpcUrl,
    });

    assert.equal(response.error?.message, "execution reverted");
  });

  it("throws a plain Error on a non-2xx, naming the status", async function () {
    respond = () => ({ body: "nope", status: 503 });

    await assert.rejects(
      () => postJsonRpc({ method: "eth_chainId", params: [], rpcUrl }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(!(error instanceof JsonRpcTransportError));
        assert.match(error.message, /HTTP 503/);
        return true;
      },
    );
  });

  it("throws JsonRpcTransportError when nothing is listening", async function () {
    await assert.rejects(
      () =>
        postJsonRpc({
          method: "eth_chainId",
          params: [],
          rpcUrl: unreachableRpcUrl,
        }),
      JsonRpcTransportError,
    );
  });
});

describe("sendLocalRpcRequest", function () {
  it("adds stale-stack recovery advice only when nothing answered", async function () {
    // The recovery hint tells a developer to restart their local stack. A node
    // that answered — even with a 503 — is not a stale stack, and sending them
    // to restart it would misdirect the debugging.
    await assert.rejects(
      () =>
        sendLocalRpcRequest({
          envFile: "/tmp/.env.local-chain",
          method: "eth_chainId",
          params: [],
          rpcUrl: unreachableRpcUrl,
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Cannot reach local RPC/);
        assert.match(error.message, /\/tmp\/\.env\.local-chain/);
        assert.match(error.message, /lsof -nP -iTCP:1 -sTCP:LISTEN/);
        return true;
      },
    );

    respond = () => ({ body: "nope", status: 503 });

    await assert.rejects(
      () =>
        sendLocalRpcRequest({
          envFile: "/tmp/.env.local-chain",
          method: "eth_chainId",
          params: [],
          rpcUrl,
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /HTTP 503/);
        assert.doesNotMatch(error.message, /out of sync/);
        return true;
      },
    );
  });
});
