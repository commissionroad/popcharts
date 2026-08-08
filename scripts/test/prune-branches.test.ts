import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// scripts/prune-branches deletes branches, worktrees and directories. Every
// check below is a guard it must not defeat: each one stands for work that a
// wrong answer destroys. Three earlier bugs — unresolved /var vs /private/var
// paths, an unresolved session cwd, and `grep -q` returning 141 under pipefail
// — each silently turned a guard into a no-op, so the guards are tested
// directly rather than trusted by reading.

const SCRIPT = join(import.meta.dirname, "..", "prune-branches");

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t.t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t.t" },
  }).trim();
}

type World = {
  root: string;
  repo: string;
  branchExists: (name: string) => boolean;
  worktreeExists: (name: string) => boolean;
};

function buildWorld(): World {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "prune-branches-")));
  const repo = join(root, "repo");
  const originDir = join(root, "origin.git");

  execFileSync("git", ["init", "--bare", "-q", originDir]);
  execFileSync("git", ["clone", "-q", originDir, repo]);
  git(repo, "commit", "-q", "--allow-empty", "-m", "base");
  git(repo, "branch", "-M", "main");
  git(repo, "push", "-q", "-u", "origin", "main");

  const landOnMain = function (branch: string): void {
    git(repo, "checkout", "-q", "-b", branch, "main");
    git(repo, "commit", "-q", "--allow-empty", "-m", `work on ${branch}`);
    git(repo, "checkout", "-q", "main");
    git(repo, "merge", "-q", "--no-ff", branch, "-m", `merge ${branch}`);
    git(repo, "push", "-q", "origin", "main");
  };
  const addWorktree = function (branch: string): string {
    const path = join(repo, ".worktrees", branch);
    git(repo, "worktree", "add", "-q", path, branch);
    return path;
  };

  landOnMain("merged-no-wt");

  landOnMain("merged-with-wt");
  addWorktree("merged-with-wt");

  // Unique commits and no PR: nothing may judge this in --auto mode.
  git(repo, "checkout", "-q", "-b", "unique-no-pr", "main");
  git(repo, "commit", "-q", "--allow-empty", "-m", "unreviewed work");
  git(repo, "checkout", "-q", "main");

  landOnMain("merged-dirty");
  const dirty = addWorktree("merged-dirty");
  writeFileSync(join(dirty, "scratch.txt"), "uncommitted\n");
  git(dirty, "add", "-A");

  landOnMain("merged-locked");
  const locked = addWorktree("merged-locked");
  git(repo, "worktree", "lock", locked);

  landOnMain("merged-busy");
  const busy = addWorktree("merged-busy");

  git(repo, "worktree", "add", "-q", "--detach", join(repo, ".worktrees", "detached"), "main");

  // A leftover directory with no .git: the only shape safe to delete by path.
  mkdirSync(join(repo, ".worktrees", "orphan-dir", "sub"), { recursive: true });
  writeFileSync(join(repo, ".worktrees", "orphan-dir", "sub", "f"), "x\n");

  git(repo, "fetch", "-q", "--prune", "origin");
  // Created last so no later push can advance origin/main past it.
  git(repo, "branch", "fresh-at-base", "origin/main");

  // Session-store seams: one unarchived session sitting in merged-busy. The
  // cwd is deliberately recorded unresolved, the way another process would.
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  mkdirSync(join(root, "running"), { recursive: true });
  writeFileSync(
    join(sessions, "local_busy.json"),
    JSON.stringify({ isArchived: false, cwd: busy }),
  );

  return {
    root,
    repo,
    branchExists(name) {
      try {
        git(repo, "show-ref", "--verify", "--quiet", `refs/heads/${name}`);
        return true;
      } catch {
        return false;
      }
    },
    worktreeExists(name) {
      const want = join(repo, ".worktrees", name);
      return git(repo, "worktree", "list", "--porcelain")
        .split("\n")
        .filter((line) => line.startsWith("worktree "))
        .map((line) => line.slice("worktree ".length))
        .some((path) => {
          try {
            return realpathSync(path) === realpathSync(want);
          } catch {
            return false;
          }
        });
    },
  };
}

function runAuto(world: World, sessionStore: string, idleHours = "0"): void {
  execFileSync(SCRIPT, ["--auto"], {
    cwd: world.repo,
    encoding: "utf8",
    env: {
      ...process.env,
      PRUNE_SESSION_STORE: sessionStore,
      PRUNE_RUNNING_STORE: join(world.root, "running"),
      // The fixture builds every worktree seconds ago. "0" disables the
      // recently-touched guard so the other guards are what is under test;
      // that guard has its own case below.
      PRUNE_MIN_IDLE_HOURS: idleHours,
    },
  });
}

test("prune-branches --auto prunes what is done and protects what is not", async function (t) {
  const world = buildWorld();
  t.after(function () {
    rmSync(world.root, { recursive: true, force: true });
  });

  runAuto(world, join(world.root, "sessions"));

  await t.test("deletes a merged branch with no worktree", function () {
    assert.equal(world.branchExists("merged-no-wt"), false);
  });

  await t.test("removes a merged branch's clean worktree and the branch", function () {
    assert.equal(world.worktreeExists("merged-with-wt"), false);
    assert.equal(world.branchExists("merged-with-wt"), false);
  });

  await t.test("keeps a branch still sitting at origin/main", function () {
    // No commits of its own: brand new, and about to be used.
    assert.equal(world.branchExists("fresh-at-base"), true);
  });

  await t.test("keeps a branch carrying unique commits with no PR", function () {
    assert.equal(world.branchExists("unique-no-pr"), true);
  });

  await t.test("keeps a worktree with uncommitted changes", function () {
    assert.equal(world.worktreeExists("merged-dirty"), true);
    assert.equal(world.branchExists("merged-dirty"), true);
  });

  await t.test("keeps a locked worktree", function () {
    assert.equal(world.worktreeExists("merged-locked"), true);
    assert.equal(world.branchExists("merged-locked"), true);
  });

  await t.test("keeps a worktree an unarchived session is sitting in", function () {
    assert.equal(world.worktreeExists("merged-busy"), true);
    assert.equal(world.branchExists("merged-busy"), true);
  });

  await t.test("keeps a detached worktree", function () {
    assert.equal(world.worktreeExists("detached"), true);
  });

  await t.test("keeps main", function () {
    assert.equal(world.branchExists("main"), true);
  });

  await t.test("removes a leftover directory git does not track", function () {
    assert.throws(function () {
      realpathSync(join(world.repo, ".worktrees", "orphan-dir"));
    });
  });
});

test("anything touched in the last few hours is protected", function (t) {
  const world = buildWorld();
  t.after(function () {
    rmSync(world.root, { recursive: true, force: true });
  });

  // Same fixture, same session store — only the recency guard is left to save
  // merged-with-wt, whose files were written moments ago. This is the backstop
  // for a session record that is missing or stale.
  runAuto(world, join(world.root, "sessions"), "6");

  assert.equal(world.worktreeExists("merged-with-wt"), true);
  assert.equal(world.branchExists("merged-with-wt"), true);

  // A directory with no .git is also what a worktree looks like in the seconds
  // before `git worktree add` finishes. Recency has to cover the path sweep,
  // not just the worktree sweep.
  assert.equal(existsSync(join(world.repo, ".worktrees", "orphan-dir")), true);
});

test("an unparseable session record stops all reaping", function (t) {
  const world = buildWorld();
  t.after(function () {
    rmSync(world.root, { recursive: true, force: true });
  });

  // Half-written or schema-changed records must not read as "no session here".
  writeFileSync(join(world.root, "sessions", "local_torn.json"), '{"isArchi');
  runAuto(world, join(world.root, "sessions"));

  assert.equal(world.worktreeExists("merged-with-wt"), true);
  assert.equal(world.worktreeExists("merged-busy"), true);
});

test("a landed branch that picks up new commits is left alone", function (t) {
  const world = buildWorld();
  t.after(function () {
    rmSync(world.root, { recursive: true, force: true });
  });

  // Reopening a branch after its work landed is ordinary. What makes it worth
  // asserting is that "already merged" was true a moment ago, so a check that
  // reads the branch name rather than a pinned commit would delete the new
  // work. The narrower TOCTOU window this shares with a concurrent writer is
  // closed structurally, by `git update-ref -d` taking the expected old OID;
  // that half is not reachable from a test without injecting a race.
  git(world.repo, "checkout", "-q", "merged-no-wt");
  git(world.repo, "commit", "-q", "--allow-empty", "-m", "reopened after landing");
  const moved = git(world.repo, "rev-parse", "HEAD");
  git(world.repo, "checkout", "-q", "main");

  runAuto(world, join(world.root, "sessions"));

  assert.equal(world.branchExists("merged-no-wt"), true);
  assert.equal(git(world.repo, "rev-parse", "merged-no-wt"), moved);
});

test("an unreadable session store protects every worktree", function (t) {
  const world = buildWorld();
  t.after(function () {
    rmSync(world.root, { recursive: true, force: true });
  });

  // Claude's session store is a private, app-version-dependent format. If it
  // moves, we cannot prove any worktree is idle — so nothing may be reaped.
  runAuto(world, join(world.root, "no-such-store"));

  assert.equal(world.worktreeExists("merged-with-wt"), true);
  assert.equal(world.worktreeExists("merged-dirty"), true);
  assert.equal(world.worktreeExists("merged-busy"), true);
});
