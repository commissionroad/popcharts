import assert from "node:assert/strict";
import { test } from "node:test";

import {
  blockReasonForCommand,
  findControlPortReferences,
} from "../guard-stack-control.ts";

const OWN = 8090;

test("finds a control port in a loopback URL, whatever the host spelling", function () {
  for (const host of ["127.0.0.1", "localhost", "0.0.0.0"]) {
    const found = findControlPortReferences(
      `curl -X POST http://${host}:8080/project/stop`,
    );
    assert.deepEqual(
      found.map((reference) => reference.port),
      [8080],
    );
  }
});

test("finds a control port passed to the process-compose CLI", function () {
  assert.deepEqual(
    findControlPortReferences("process-compose process stop keeper -p 8080").map(
      (reference) => reference.port,
    ),
    [8080],
  );
  assert.deepEqual(
    findControlPortReferences("process-compose attach --port=8100").map(
      (reference) => reference.port,
    ),
    [8100],
  );
});

test("ignores ports outside the control grid", function () {
  // The API, app and chain all live on loopback too; intercepting those would
  // make the guard unusable.
  for (const command of [
    "curl http://127.0.0.1:3001/markets",
    "curl http://127.0.0.1:3010/api/health",
    "curl http://127.0.0.1:8545",
    "curl http://127.0.0.1:8081/process/stop/keeper",
  ]) {
    assert.deepEqual(findControlPortReferences(command), []);
  }
});

test("ignores a matching port on a host that is not ours", function () {
  assert.deepEqual(
    findControlPortReferences("curl https://example.com:8080/project/stop"),
    [],
  );
});

test("allows a command that addresses this worktree's own control port", function () {
  assert.equal(
    blockReasonForCommand({
      command: `curl -X PATCH http://127.0.0.1:${OWN}/process/stop/keeper`,
      ownControlPort: OWN,
    }),
    null,
  );
});

test("blocks a command that addresses another worktree's control port", function () {
  const reason = blockReasonForCommand({
    command: "curl -X POST http://127.0.0.1:8080/project/stop",
    ownControlPort: OWN,
  });

  assert.match(reason ?? "", /Refusing to drive another worktree's dev stack/);
  assert.match(reason ?? "", /8080/);
  assert.match(reason ?? "", /local:stack/);
});

test("blocks every control port when this worktree has no stack running", function () {
  // Both real incidents were exactly this: a worktree with no stack of its own
  // commanding the primary checkout's.
  const reason = blockReasonForCommand({
    command: "curl http://127.0.0.1:8080/processes",
    ownControlPort: null,
  });

  assert.match(reason ?? "", /no running stack/);
});

test("blocks when a command mixes its own port with a foreign one", function () {
  const reason = blockReasonForCommand({
    command: `curl http://127.0.0.1:${OWN}/processes; curl -X POST http://127.0.0.1:8080/project/stop`,
    ownControlPort: OWN,
  });

  assert.match(reason ?? "", /8080/);
  assert.doesNotMatch(reason ?? "", /8090,/);
});

test("allows ordinary commands untouched", function () {
  for (const command of [
    "git status",
    "pnpm run app:check",
    "echo 'http://127.0.0.1:8080 is the primary stack'".replace("8080", "3000"),
  ]) {
    assert.equal(
      blockReasonForCommand({ command, ownControlPort: OWN }),
      null,
    );
  }
});
