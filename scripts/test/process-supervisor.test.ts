import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { sleep } from "../shared/wait/sleep.ts";
import { createProcessSupervisor } from "../shared/process/processSupervisor.ts";

/**
 * Guards the two properties the stack-control restart path depends on:
 *  - a signal-terminated child is marked `exited` even though `code` stays
 *    null (so a follow-on start() respawns instead of no-oping); and
 *  - stop() kills the child's whole process group, so a `bun run` wrapper's
 *    real service (a grandchild) cannot survive a SIGKILL of the wrapper.
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

  it("kills the whole group so a wrapper's grandchild cannot orphan", async () => {
    const supervisor = createProcessSupervisor({
      cwd: process.cwd(),
      // Short escalation so the wedged-child path resolves quickly.
      killGraceMs: 250,
      logLabel: "supervisor-test",
    });
    const dir = mkdtempSync(join(tmpdir(), "supervisor-group-"));
    const pidFile = join(dir, "grandchild.pid");

    try {
      // The supervised child is a wrapper (like `bun run`) that spawns a
      // grandchild ignoring SIGTERM and running forever, records its pid, then
      // ignores SIGTERM itself — so only a group-wide SIGKILL brings both down.
      const wrapperScript = [
        "const { spawn } = require('node:child_process');",
        "const { writeFileSync } = require('node:fs');",
        "const g = spawn(process.execPath, ['-e', \"process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)\"], { stdio: 'ignore' });",
        `writeFileSync(${JSON.stringify(pidFile)}, String(g.pid));`,
        "process.on('SIGTERM', () => {});",
        "setInterval(() => {}, 1000);",
      ].join("\n");

      const proc = supervisor.start("wrapper", process.execPath, [
        "-e",
        wrapperScript,
      ]);

      const grandchildPid = await readPidWhenReady(pidFile);
      assert.ok(
        isAlive(grandchildPid),
        "grandchild should be running before stop()",
      );

      await supervisor.stop(proc);

      // The group SIGKILL must reach the grandchild; allow the OS a beat to
      // reap it after reparenting, then assert it is gone.
      await waitUntil(() => !isAlive(grandchildPid), 5_000);
      assert.equal(
        isAlive(grandchildPid),
        false,
        "grandchild must be killed with the group, not orphaned",
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});

/** True unless signalling the pid fails with ESRCH (no such process). */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but we may not signal it — still alive.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readPidWhenReady(pidFile: string): Promise<number> {
  await waitUntil(() => existsSync(pidFile) && readFileSync(pidFile, "utf8").trim() !== "", 5_000);
  return Number(readFileSync(pidFile, "utf8").trim());
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(`condition not met within ${timeoutMs}ms`);
    }
    await sleep(50);
  }
}
