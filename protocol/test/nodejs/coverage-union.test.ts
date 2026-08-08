import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LiveCoverageUnion, MonotoneCoverageUnion } from "../../src/clearing/coverage-union.js";
import { normalizePathSegments, type PathSegment } from "../../src/clearing/opposed-set.js";
import { makeRng } from "./opposed-set-walk-fixtures.js";

describe("MonotoneCoverageUnion", () => {
  it("merges overlapping and touching inserts into minimal fragments", () => {
    const union = new MonotoneCoverageUnion();

    assert.deepEqual(union.insert({ rHigh: 10n, rLow: 0n }), {
      recordsCreated: 1,
      recordsDeleted: 0,
      recordsRewritten: 0,
    });
    // Touching extends the fragment in place: one record rewritten.
    assert.deepEqual(union.insert({ rHigh: 15n, rLow: 10n }), {
      recordsCreated: 0,
      recordsDeleted: 0,
      recordsRewritten: 1,
    });
    // Contained: nothing to write.
    assert.deepEqual(union.insert({ rHigh: 8n, rLow: 2n }), {
      recordsCreated: 0,
      recordsDeleted: 0,
      recordsRewritten: 0,
    });
    // Disjoint: a second fragment record.
    assert.deepEqual(union.insert({ rHigh: 30n, rLow: 20n }), {
      recordsCreated: 1,
      recordsDeleted: 0,
      recordsRewritten: 0,
    });
    // Bridging both fragments rewrites one record and deletes the other.
    assert.deepEqual(union.insert({ rHigh: 22n, rLow: 12n }), {
      recordsCreated: 0,
      recordsDeleted: 1,
      recordsRewritten: 1,
    });
    assert.deepEqual(union.fragments(), [{ rHigh: 30n, rLow: 0n }]);
  });

  it("counts the fragments a withdrawal-time intersection must read", () => {
    const union = new MonotoneCoverageUnion();
    union.insert({ rHigh: 2n, rLow: 0n });
    union.insert({ rHigh: 6n, rLow: 4n });
    union.insert({ rHigh: 10n, rLow: 8n });
    assert.equal(union.fragmentsOverlapping({ rHigh: 9n, rLow: 5n }), 2);
    assert.equal(union.fragmentsOverlapping({ rHigh: 4n, rLow: 2n }), 0);
  });

  it("a merge across n disjoint fragments deletes n−1 records in one insert", () => {
    const union = new MonotoneCoverageUnion();
    for (let i = 0; i < 50; i += 1) {
      union.insert({ rHigh: BigInt(i * 4 + 2), rLow: BigInt(i * 4) });
    }
    assert.equal(union.fragmentCount, 50);

    const costs = union.insert({ rHigh: 200n, rLow: 0n });
    assert.deepEqual(costs, { recordsCreated: 0, recordsDeleted: 49, recordsRewritten: 1 });
    assert.equal(union.fragmentCount, 1);
  });
});

describe("LiveCoverageUnion", () => {
  it("insert and remove are two boundary writes each, and counts stack", () => {
    const union = new LiveCoverageUnion();

    assert.deepEqual(union.insert({ rHigh: 10n, rLow: 0n }), {
      recordsCreated: 2,
      recordsDeleted: 0,
      recordsRewritten: 0,
    });
    // Overlapping coverage shares no boundary: two more records.
    union.insert({ rHigh: 15n, rLow: 5n });
    assert.equal(union.boundaryCount, 4);
    assert.deepEqual(union.union(), [{ rHigh: 15n, rLow: 0n }]);

    // Removing one cover leaves the doubly-covered middle covered.
    assert.deepEqual(union.remove({ rHigh: 10n, rLow: 0n }), {
      recordsCreated: 0,
      recordsDeleted: 2,
      recordsRewritten: 0,
    });
    assert.deepEqual(union.union(), [{ rHigh: 15n, rLow: 5n }]);
  });

  it("shared boundaries cancel: a walk's touching intervals reuse records", () => {
    const union = new LiveCoverageUnion();
    union.insert({ rHigh: 10n, rLow: 0n });
    // The +1 at 10 cancels the previous −1 at 10: one delete, one create.
    assert.deepEqual(union.insert({ rHigh: 20n, rLow: 10n }), {
      recordsCreated: 1,
      recordsDeleted: 1,
      recordsRewritten: 0,
    });
    assert.equal(union.boundaryCount, 2);
    assert.deepEqual(union.union(), [{ rHigh: 20n, rLow: 0n }]);
  });

  it("throws on removing coverage that was never inserted", () => {
    const union = new LiveCoverageUnion();
    union.insert({ rHigh: 10n, rLow: 0n });
    union.remove({ rHigh: 30n, rLow: 20n });
    assert.throws(() => union.union(), /Negative cover count/);
  });

  it("matches the monotone union while nothing is ever removed", () => {
    const rng = makeRng(0xc0ffee);
    for (let trial = 0; trial < 200; trial += 1) {
      const monotone = new MonotoneCoverageUnion();
      const live = new LiveCoverageUnion();
      const inserted: PathSegment[] = [];
      const count = 1 + Math.floor(rng() * 12);
      for (let i = 0; i < count; i += 1) {
        const rLow = BigInt(Math.floor(rng() * 200) - 100);
        const segment = { rHigh: rLow + BigInt(1 + Math.floor(rng() * 40)), rLow };
        monotone.insert(segment);
        live.insert(segment);
        inserted.push(segment);
      }
      assert.deepEqual(monotone.fragments(), normalizePathSegments(inserted));
      assert.deepEqual(live.union(), normalizePathSegments(inserted));
    }
  });

  it("diverges from the monotone union exactly where coverage was removed", () => {
    const monotone = new MonotoneCoverageUnion();
    const live = new LiveCoverageUnion();
    for (const segment of [
      { rHigh: 10n, rLow: 0n },
      { rHigh: 30n, rLow: 20n },
    ]) {
      monotone.insert(segment);
      live.insert(segment);
    }

    live.remove({ rHigh: 10n, rLow: 0n });
    assert.deepEqual(live.union(), [{ rHigh: 30n, rLow: 20n }]);
    // The monotone union still reports the vacated interval as covered — the
    // over-locking route 1(a) trades for never shrinking.
    assert.deepEqual(monotone.fragments(), [
      { rHigh: 10n, rLow: 0n },
      { rHigh: 30n, rLow: 20n },
    ]);
  });
});
