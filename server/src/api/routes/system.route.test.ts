import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import type { db as productionDb } from "src/db/client";
import { schema, setDbForTesting } from "src/db/client";
import { createPgliteDb } from "src/test-support/pglite-db";

let app: (typeof import("src/api"))["app"];
let dbc: typeof productionDb;
let teardownDb: () => Promise<void>;

beforeAll(async () => {
  ({ dbc, teardown: teardownDb } = await createPgliteDb());
  setDbForTesting(dbc);

  await dbc.insert(schema.contracts).values({
    address: "0x0000000000000000000000000000000000000011",
    chainId: 1,
    name: "SystemRouteTest",
  });

  ({ app } = await import("src/api"));
}, 15_000);

afterAll(async () => {
  setDbForTesting(null);
  await teardownDb();
});

describe("system routes", () => {
  it("returns the health response", async () => {
    const response = await app.handle(new Request("http://localhost/health"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("returns build and network version information", async () => {
    const response = await app.handle(new Request("http://localhost/version"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      buildTime: expect.any(String),
      commitSha: process.env.GIT_COMMIT_SHA ?? "development",
      network: expect.stringMatching(/^(arcTestnet|local)$/),
      version: "0.1.0",
    });
    expect(Number.isNaN(Date.parse(body.buildTime))).toBe(false);
  });
});
