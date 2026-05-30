import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  checkGitRepo,
  commit,
  getRepoRoot,
  getStagedDiff,
  getUnstagedDiff,
} from "../dist/git/diff.js";

function createTempDir() {
  return mkdtempSync(join(tmpdir(), "commit-echo-git-diff-test-"));
}

function git(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: "pipe",
  });
}

function initRepo() {
  const repoDir = createTempDir();

  git(["init"], repoDir);
  git(["config", "user.name", "Test User"], repoDir);
  git(["config", "user.email", "test@example.com"], repoDir);

  return repoDir;
}

function withCwd(dir, fn) {
  const previousCwd = process.cwd();

  try {
    process.chdir(dir);
    return fn();
  } finally {
    process.chdir(previousCwd);
  }
}

test("checkGitRepo returns successfully inside a git repo", () => {
  const repoDir = initRepo();

  try {
    withCwd(repoDir, () => {
      assert.doesNotThrow(() => checkGitRepo());
    });
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("checkGitRepo throws outside a git repo", () => {
  const dir = createTempDir();

  try {
    withCwd(dir, () => {
      assert.throws(() => checkGitRepo(), /git repository/i);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getStagedDiff returns diff when changes are staged", () => {
  const repoDir = initRepo();

  try {
    writeFileSync(join(repoDir, "file.txt"), "hello\n", "utf-8");
    git(["add", "file.txt"], repoDir);

    withCwd(repoDir, () => {
      const result = getStagedDiff();

      assert.equal(result.hasChanges, true);
      assert.equal(result.staged, true);
      assert.ok(result.diff.includes("diff --git"));
      assert.ok(result.diff.includes("+hello"));
    });
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("getStagedDiff returns empty diff when no changes are staged", () => {
  const repoDir = initRepo();

  try {
    withCwd(repoDir, () => {
      const result = getStagedDiff();

      assert.equal(result.diff, "");
      assert.equal(result.hasChanges, false);
      assert.equal(result.staged, true);
    });
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("getUnstagedDiff returns diff for unstaged changes", () => {
  const repoDir = initRepo();

  try {
    writeFileSync(join(repoDir, "file.txt"), "hello\n", "utf-8");
    git(["add", "file.txt"], repoDir);
    git(["commit", "-m", "initial commit"], repoDir);

    writeFileSync(join(repoDir, "file.txt"), "hello\nworld\n", "utf-8");

    withCwd(repoDir, () => {
      const result = getUnstagedDiff();

      assert.equal(result.hasChanges, true);
      assert.equal(result.staged, false);
      assert.ok(result.diff.includes("diff --git"));
      assert.ok(result.diff.includes("+world"));
    });
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("commit commits staged changes and returns output with the commit hash", () => {
  const repoDir = initRepo();

  try {
    writeFileSync(join(repoDir, "file.txt"), "hello\n", "utf-8");
    git(["add", "file.txt"], repoDir);

    withCwd(repoDir, () => {
      const output = commit("test: add file");

      assert.match(output, /\[[^\]]*[a-f0-9]{7,}\] test: add file/);
    });

    const hash = git(["rev-parse", "HEAD"], repoDir).trim();
    const log = git(["log", "--oneline", "-1"], repoDir);

    assert.match(hash, /^[a-f0-9]{40}$/);
    assert.ok(log.includes("test: add file"));
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("getRepoRoot returns the absolute path of the repository root", () => {
  const repoDir = initRepo();
  const nestedDir = join(repoDir, "src", "nested");

  try {
    mkdirSync(nestedDir, { recursive: true });

    assert.equal(existsSync(nestedDir), true);

    withCwd(nestedDir, () => {
      assert.equal(getRepoRoot(), repoDir);
    });
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});
