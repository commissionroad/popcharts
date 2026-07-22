import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createProcessSupervisor } from "../shared/process/processSupervisor.ts";

/**
 * Guards the liveness flag the stack-control restart path depends on. A
 * signal-terminated child (how stop() ends one) exits with `code === null` —
 * the same value it holds while running — so liveness must be read from
 * `exited`, not `code`. Before that distinction existed, stop() left the
 * process looking "still running", and a follow-on start() no-oped instead of
 * respawning it.
 */
describe("processSupervisor", () => {
  it("marks a signal-terminated child as exited (code stays null)", async () => {
    const supervisor = createProcessSupervisor({
      cwd: process.cwd(),
      logLabel: "supervisor-test",
    });

    // A child that runs until a signal kills it; Node's default SIGTERM
    // action terminates it, so `code` is null and `signal` carries the cause.
    const proc = supervisor.start("sleeper", process.execPath, [
      "-e",
      "setInterval(() => {}, 1000)",
    ]);
    assert.equal(proc.exited, false);
    supervisor.assertRunning([proc]);

    await supervisor.stop(proc);

    assert.equal(proc.exited, true, "signal exit must set the exited flag");
    assert.equal(proc.code, null, "signal exit leaves the numeric code null");
    assert.throws(
      () => supervisor.assertRunning([proc]),
      /exited before the flow completed/,
    );
  });

  it("stop() on an already-exited child is a no-op", async () => {
    const supervisor = createProcessSupervisor({
      cwd: process.cwd(),
      logLabel: "supervisor-test",
    });
    const proc = supervisor.start("sleeper", process.execPath, [
      "-e",
      "setInterval(() => {}, 1000)",
    ]);
    await supervisor.stop(proc);
    assert.equal(proc.exited, true);

    // Must resolve without throwing or hanging on a second stop.
    await supervisor.stop(proc);
    assert.equal(proc.exited, true);
  });
});
