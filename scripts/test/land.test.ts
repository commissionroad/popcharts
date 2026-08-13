import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// scripts/land merges a PR and then cleans up. The cleanup is the part that
// matters: the merge is idempotent and visible on GitHub, while a half-run
// leaves a branch, a worktree and an un-pulled base branch behind by hand.
//
// The bug these tests pin: this repo enables `deleteBranchOnMerge`, so GitHub
// deletes the head branch itself moments after the merge API returns. `land`
// used to check the ref still existed and then push a delete — and lost that
// race on essentially every land, because the stacked-PR lookup sits between
// the check and the push. Under `set -e` the failed push aborted the script
// before it pulled the base branch, removed the worktree, or deleted the local
// branch. The tests below drive the whole script against a real git origin,
// with `gh` faked, so the cleanup is asserted rather than read.

const SCRIPT = join(import.meta.dirname, "..", "land");

const PR_NUMBER = "7";
const HEAD_BRANCH = "feature";
const BASE_BRANCH = "main";

const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t.t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t.t",
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...GIT_IDENTITY },
  }).trim();
}

// Stands in for the GitHub API surface `land` calls. It keeps the PR's state in
// a file and, on merge, performs the merge for real in a server-side clone so
// the base branch actually advances on origin — otherwise the `pull --ff-only`
// step would pass vacuously.
const FAKE_GH = `#!/usr/bin/env bash
set -euo pipefail

write_state() {
  cat >"$FAKE_GH_STATE" <<JSON
{
  "number": ${PR_NUMBER},
  "state": "$1",
  "headRefName": "${HEAD_BRANCH}",
  "baseRefName": "${BASE_BRANCH}",
  "url": "https://github.test/pr/${PR_NUMBER}",
  "isCrossRepository": false,
  "mergeCommit": $2,
  "mergedAt": $3
}
JSON
}

case "$1 $2" in
  "pr list")
    # --state all is the "find the PR for this branch" lookup; --state open is
    # the stacked-PR lookup, which this fixture answers with no PRs.
    if [[ "$*" == *"--state all"* ]]; then
      printf '%s\\n' "${PR_NUMBER}"
    elif [[ "\${FAKE_GH_DELETE_ON_STACKED_LOOKUP:-0}" == "1" ]]; then
      # GitHub's asynchronous branch cleanup landing mid-window: the stacked-PR
      # lookup is the API round trip that sat between the old existence check
      # and the delete push.
      git -C "$FAKE_GH_SERVER" push -q origin --delete "${HEAD_BRANCH}"
    fi
    ;;
  "pr view")
    cat "$FAKE_GH_STATE"
    ;;
  "pr edit")
    ;;
  "api "*)
    [[ "$*" == *"/merge"* ]] || { echo "fake gh: unexpected api call: $*" >&2; exit 1; }
    git -C "$FAKE_GH_SERVER" fetch -q origin
    git -C "$FAKE_GH_SERVER" checkout -q -B "${BASE_BRANCH}" "origin/${BASE_BRANCH}"
    git -C "$FAKE_GH_SERVER" merge -q --no-ff "origin/${HEAD_BRANCH}" -m "Merge pull request #${PR_NUMBER}"
    git -C "$FAKE_GH_SERVER" push -q origin "${BASE_BRANCH}"
    oid="$(git -C "$FAKE_GH_SERVER" rev-parse HEAD)"
    if [[ "\${FAKE_GH_DELETE_ON_MERGE:-0}" == "1" ]]; then
      git -C "$FAKE_GH_SERVER" push -q origin --delete "${HEAD_BRANCH}"
    fi
    if [[ "\${FAKE_GH_BREAK_ORIGIN:-0}" == "1" ]]; then
      mv "$FAKE_GH_ORIGIN" "$FAKE_GH_ORIGIN.moved"
    fi
    write_state MERGED "{\\"oid\\": \\"$oid\\"}" '"2026-08-13T00:00:00Z"'
    ;;
  *)
    echo "fake gh: unsupported command: $*" >&2
    exit 1
    ;;
esac
`;

type World = {
  root: string;
  repo: string;
  headWorktree: string;
  env: NodeJS.ProcessEnv;
};

function buildWorld(): World {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "land-")));
  const origin = join(root, "origin.git");
  const repo = join(root, "repo");
  const server = join(root, "server");
  const bin = join(root, "bin");
  const state = join(root, "pr.json");

  execFileSync("git", ["init", "--bare", "-q", origin]);
  execFileSync("git", ["clone", "-q", origin, repo]);
  // Worktrees live in an ignored directory inside the checkout, as they do in
  // the real repo. Without the ignore, `land` reads its own worktree as an
  // uncommitted change in the base checkout and refuses to pull.
  writeFileSync(join(repo, ".gitignore"), ".worktrees/\n");
  git(repo, "add", ".gitignore");
  git(repo, "commit", "-q", "-m", "base");
  git(repo, "branch", "-M", BASE_BRANCH);
  git(repo, "push", "-q", "-u", "origin", BASE_BRANCH);

  // The head branch lives in its own worktree, the way a real session's does,
  // so worktree removal is exercised and `land` runs from inside the worktree
  // it is about to delete.
  const headWorktree = join(repo, ".worktrees", HEAD_BRANCH);
  git(repo, "worktree", "add", "-q", "-b", HEAD_BRANCH, headWorktree, BASE_BRANCH);
  git(headWorktree, "commit", "-q", "--allow-empty", "-m", "feature work");
  git(headWorktree, "push", "-q", "-u", "origin", HEAD_BRANCH);

  execFileSync("git", ["clone", "-q", origin, server]);

  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "gh"), FAKE_GH);
  chmodSync(join(bin, "gh"), 0o755);

  writeFileSync(
    state,
    JSON.stringify({
      number: Number(PR_NUMBER),
      state: "OPEN",
      headRefName: HEAD_BRANCH,
      baseRefName: BASE_BRANCH,
      url: `https://github.test/pr/${PR_NUMBER}`,
      isCrossRepository: false,
      mergeCommit: null,
      mergedAt: null,
    }),
  );

  return {
    root,
    repo,
    headWorktree,
    env: {
      ...process.env,
      ...GIT_IDENTITY,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      FAKE_GH_STATE: state,
      FAKE_GH_SERVER: server,
      FAKE_GH_ORIGIN: origin,
    },
  };
}

// `land` reports every step through say(), which writes to stderr, so the
// transcript under test is stderr — not stdout.
function runLand(world: World, env: NodeJS.ProcessEnv = {}): { status: number | null; log: string } {
  const result = spawnSync(SCRIPT, [], {
    cwd: world.headWorktree,
    encoding: "utf8",
    env: { ...world.env, ...env },
  });
  return { status: result.status, log: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

function branchExists(repo: string, name: string): boolean {
  try {
    git(repo, "show-ref", "--verify", "--quiet", `refs/heads/${name}`);
    return true;
  } catch {
    return false;
  }
}

function remoteBranchExists(repo: string, name: string): boolean {
  try {
    execFileSync("git", ["ls-remote", "--exit-code", "--heads", "origin", name], {
      cwd: repo,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function assertFullyCleanedUp(world: World): void {
  assert.equal(existsSync(world.headWorktree), false, "feature worktree still present");
  assert.equal(branchExists(world.repo, HEAD_BRANCH), false, "local feature branch still present");
  assert.equal(remoteBranchExists(world.repo, HEAD_BRANCH), false, "remote feature branch still present");

  // The base branch must have been pulled: the merge commit made on the server
  // has to be reachable from the local base branch.
  const localBase = git(world.repo, "rev-parse", BASE_BRANCH);
  const remoteBase = git(world.repo, "rev-parse", `origin/${BASE_BRANCH}`);
  assert.equal(localBase, remoteBase, "base branch was not pulled");
}

test("lands and cleans up when the merge deletes the remote branch first", function (t) {
  const world = buildWorld();
  t.after(function () {
    rmSync(world.root, { recursive: true, force: true });
  });

  // deleteBranchOnMerge is enabled on this repo, so this is the normal path,
  // not an edge case. Every land takes it.
  const { status, log } = runLand(world, { FAKE_GH_DELETE_ON_MERGE: "1" });

  assert.equal(status, 0, log);
  assertFullyCleanedUp(world);
  assert.match(log, /Remote branch origin\/feature was already deleted on merge/);
  assert.match(log, new RegExp(`Done: PR #${PR_NUMBER} landed into ${BASE_BRANCH}`));
});

test("lands and cleans up when the remote branch vanishes mid-delete", function (t) {
  const world = buildWorld();
  t.after(function () {
    rmSync(world.root, { recursive: true, force: true });
  });

  // The failure reported from landing PR #542. GitHub's branch cleanup lands
  // after `land` has already confirmed the ref exists, so no pre-check can
  // save it — the delete has to tolerate the outcome instead.
  const { status, log } = runLand(world, { FAKE_GH_DELETE_ON_STACKED_LOOKUP: "1" });

  assert.equal(status, 0, log);
  assertFullyCleanedUp(world);
  assert.match(log, new RegExp(`Done: PR #${PR_NUMBER} landed into ${BASE_BRANCH}`));
});

test("lands and cleans up when it deletes the remote branch itself", function (t) {
  const world = buildWorld();
  t.after(function () {
    rmSync(world.root, { recursive: true, force: true });
  });

  const { status, log } = runLand(world);

  assert.equal(status, 0, log);
  assertFullyCleanedUp(world);
  assert.match(log, new RegExp(`Done: PR #${PR_NUMBER} landed into ${BASE_BRANCH}`));
});

test("a rejected delete that leaves the branch alive is fatal", function (t) {
  const world = buildWorld();
  t.after(function () {
    rmSync(world.root, { recursive: true, force: true });
  });

  // The other half of the tolerance rule. Here the remote is reachable and
  // answers, but refuses the deletion, so the branch is still there afterwards.
  // Reporting a clean land would strand it.
  execFileSync("git", ["config", "--bool", "receive.denyDeletes", "true"], {
    cwd: join(world.root, "origin.git"),
  });

  const { status, log } = runLand(world);

  assert.notEqual(status, 0, "land reported success after a rejected delete");
  assert.match(log, /failed to delete remote branch origin\/feature/);
  assert.equal(remoteBranchExists(world.repo, HEAD_BRANCH), true, "branch was reported deleted but survived");
});

test("a remote-branch delete that fails because the remote is unreachable is fatal", function (t) {
  const world = buildWorld();
  t.after(function () {
    rmSync(world.root, { recursive: true, force: true });
  });

  // Tolerating "already gone" must not become tolerating every push failure.
  // Here origin disappears after the merge, so the delete fails for a reason
  // that leaves the branch alive.
  const { status, log } = runLand(world, { FAKE_GH_BREAK_ORIGIN: "1" });

  assert.notEqual(status, 0, "land reported success after a failed delete");
  assert.match(log, /failed to delete remote branch origin\/feature/);

  renameSync(`${join(world.root, "origin.git")}.moved`, join(world.root, "origin.git"));
  assert.equal(remoteBranchExists(world.repo, HEAD_BRANCH), true, "branch was reported deleted but survived");
});
