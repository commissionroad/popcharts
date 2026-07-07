import { describe, expect, it } from "bun:test";

import { createSingleFlightScheduler } from "./scheduler";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("createSingleFlightScheduler", () => {
  it("coalesces triggers that arrive while a run is in flight", async () => {
    const scheduler = createSingleFlightScheduler({ onError: () => {} });
    const gate = deferred();
    let runs = 0;

    const first = scheduler.schedule("m", async () => {
      runs += 1;
      if (runs === 1) {
        await gate.promise;
      }
    });

    // Three triggers land mid-run; they must collapse into one trailing run.
    void scheduler.schedule("m", async () => {
      runs += 1;
    });
    void scheduler.schedule("m", async () => {
      runs += 1;
    });
    gate.resolve();
    await first;

    expect(runs).toBe(2);
    expect(scheduler.inFlight()).toBe(0);
  });

  it("keeps keys independent", async () => {
    const scheduler = createSingleFlightScheduler({ onError: () => {} });
    const order: string[] = [];

    await Promise.all([
      scheduler.schedule("a", async () => {
        order.push("a");
      }),
      scheduler.schedule("b", async () => {
        order.push("b");
      }),
    ]);

    expect(order.sort()).toEqual(["a", "b"]);
  });

  it("reports failures and still runs the latest trailing task", async () => {
    const errors: string[] = [];
    const scheduler = createSingleFlightScheduler({
      onError: (key) => errors.push(key),
    });
    const gate = deferred();
    let secondRan = false;

    const first = scheduler.schedule("m", async () => {
      await gate.promise;
      throw new Error("boom");
    });
    void scheduler.schedule("m", async () => {
      secondRan = true;
    });
    gate.resolve();
    await first;

    expect(errors).toEqual(["m"]);
    expect(secondRan).toBe(true);
    expect(scheduler.inFlight()).toBe(0);
  });
});
