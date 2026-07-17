import { createServer } from "node:net";

/**
 * True when a TCP port can be exclusively bound on `127.0.0.1` right now.
 *
 * Attempts a real listen on the loopback interface and resolves `true` only if
 * the bind succeeds (the server is closed again before resolving). Resolves
 * `false` on `EADDRINUSE` — the signal that another local dev stack (or any
 * other process) already holds the port — and on any other bind error, so a
 * caller can treat "not cleanly bindable" as "not free". Used by slot
 * resolution to advance past a slot whose derived ports are occupied.
 */
export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();

    server.once("error", () => {
      resolve(false);
    });

    server.once("listening", () => {
      server.close(() => {
        resolve(true);
      });
    });

    server.listen(port, "127.0.0.1");
  });
}
