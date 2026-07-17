import assert from "node:assert/strict";
import { createServer, type Server } from "node:net";
import { test } from "node:test";

import { isPortFree } from "../shared/localStack/isPortFree.ts";

/** Bind a loopback server to an OS-assigned port and return it plus the port. */
function listenOnEphemeralPort(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("expected an AddressInfo from an ephemeral listen"));
        return;
      }
      resolve({ server, port: address.port });
    });
  });
}

test("isPortFree returns false while a port is held, true once released", async () => {
  const { server, port } = await listenOnEphemeralPort();

  assert.equal(
    await isPortFree(port),
    false,
    "a port with a live listener must read as occupied",
  );

  await new Promise<void>((resolve) => server.close(() => resolve()));

  assert.equal(
    await isPortFree(port),
    true,
    "the same port must read as free after the listener closes",
  );
});
