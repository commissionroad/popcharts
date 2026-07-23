import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { describe, it } from "node:test";

import { signalProcessGroup } from "../shared/process/signalProcessGroup.ts";
import { isAlive, waitUntil } from "./support/processLiveness.ts";

/**
 * Guards the primitive both orchestrator teardowns rely on: a signal has to
 * reach every process a wrapper started, not just the wrapper. The nightly
 * lifecycle job burned to its 40-minute step timeout after a green suite
 * because surviving services held the job's stdout pipe open.
 */
describe("signalProcessGroup", () => {
  it("reaches a grandchild the wrapper spawned", async () => {
    // Mirrors the real shape: a wrapper (`pnpm run x`) whose grandchild is the
    // actual service. Both ignore SIGTERM, so only a group-wide SIGKILL ends
    // them — signalling the wrapper's pid alone would leave the service up.
    const wrapper = spawn(
      process.execPath,
      [
        "-e",
        [
          "const { spawn } = require('node:child_process');",
          "const g = spawn(process.execPath, ['-e', \"process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)\"], { stdio: 'ignore' });",
          "process.stdout.write(String(g.pid));",
          "process.on('SIGTERM', () => {});",
          "setInterval(() => {}, 1000);",
        ].join("\n"),
      ],
      { detached: true, stdio: ["ignore", "pipe", "ignore"] },
    );

    try {
      const grandchildPid = Number(await readFirstChunk(wrapper));
      assert.ok(isAlive(grandchildPid), "grandchild should start alive");

      assert.equal(signalProcessGroup(wrapper.pid, "SIGKILL"), null);

      await waitUntil(() => !isAlive(grandchildPid), 5_000);
      assert.equal(
        isAlive(grandchildPid),
        false,
        "the group signal must reach the grandchild, not just the wrapper",
      );
    } finally {
      signalProcessGroup(wrapper.pid, "SIGKILL");
    }
  });

  it("swallows ESRCH when the group is already gone", async () => {
    const child = spawn(process.execPath, ["-e", ""], {
      detached: true,
      stdio: "ignore",
    });
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));

    // The expected race: the child exited on its own just before teardown.
    assert.equal(signalProcessGroup(child.pid, "SIGTERM"), null);
  });

  it("is a no-op for an undefined pid", () => {
    assert.equal(signalProcessGroup(undefined, "SIGKILL"), null);
  });
});

/** Resolves with the first stdout chunk the child writes. */
async function readFirstChunk(child: ReturnType<typeof spawn>): Promise<string> {
  return new Promise<string>((resolve) => {
    child.stdout?.once("data", (chunk: Buffer) => resolve(chunk.toString()));
  });
}

