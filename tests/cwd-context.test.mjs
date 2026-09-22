import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { getBranchName, getLastCommitMessage } from "../dist/git/diff.js";

function createTempDir() {
  return mkdtempSync(join(tmpdir(), "commit-echo-cwd-"));
}

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
}

function initRepo() {
  const dir = createTempDir();
  git(["init"], dir);
  git(["config", "user.email", "test@example.com"], dir);
  git(["config", "user.name", "Test User"], dir);
  return dir;
}

test("getBranchName reads the requested repository instead of process.cwd()", () => {
  const repoDir = initRepo();
  try {
    git(["commit", "--allow-empty", "-m", "initial commit"], repoDir);
    const branchName = git(["rev-parse", "--abbrev-ref", "HEAD"], repoDir).trim();
    assert.equal(getBranchName(repoDir), branchName);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("getLastCommitMessage reads the requested repository instead of process.cwd()", () => {
  const repoDir = initRepo();
  try {
    git(["commit", "--allow-empty", "-m", "initial commit"], repoDir);
    assert.equal(getLastCommitMessage(repoDir), "initial commit");
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});
