import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

import { checkGitRepo, getStagedDiff, getUnstagedDiff, commit, getRepoRoot } from '../dist/git/diff.js';

function createGitRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'commit-echo-test-'));
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email test@test.com', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name Test', { cwd: dir, stdio: 'pipe' });
  return dir;
}

function createFile(dir, name, content) {
  const filePath = join(dir, name);
  writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

function gitAdd(dir) {
  execSync('git add -A', { cwd: dir, stdio: 'pipe' });
}

function gitCommit(dir, msg) {
  execSync(`git commit -m "${msg}"`, { cwd: dir, stdio: 'pipe' });
}

const originalDir = process.cwd();

test('checkGitRepo() returns successfully inside a git repo', () => {
  const dir = createGitRepo();
  try {
    process.chdir(dir);
    checkGitRepo(); // should not throw
    assert.ok(true);
  } finally {
    process.chdir(originalDir);
  }
});

test('checkGitRepo() throws outside a git repo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'commit-echo-test-'));
  try {
    process.chdir(dir);
    assert.throws(() => checkGitRepo(), /not a git repository/);
  } finally {
    process.chdir(originalDir);
  }
});

test('getStagedDiff() returns diff when changes are staged', () => {
  const dir = createGitRepo();
  createFile(dir, 'test.txt', 'hello');
  gitAdd(dir);
  try {
    process.chdir(dir);
    const result = getStagedDiff();
    assert.equal(result.staged, true);
    assert.equal(result.hasChanges, true);
    assert.ok(result.diff.includes('test.txt'));
  } finally {
    process.chdir(originalDir);
  }
});

test('getStagedDiff() returns empty when nothing is staged', () => {
  const dir = createGitRepo();
  createFile(dir, 'test.txt', 'hello');
  try {
    process.chdir(dir);
    const result = getStagedDiff();
    assert.equal(result.hasChanges, false);
    assert.equal(result.diff, '');
  } finally {
    process.chdir(originalDir);
  }
});

test('getUnstagedDiff() returns diff for unstaged changes', () => {
  const dir = createGitRepo();
  createFile(dir, 'tracked.txt', 'original');
  gitAdd(dir);
  gitCommit(dir, 'initial');
  writeFileSync(join(dir, 'tracked.txt'), 'modified', 'utf-8');
  try {
    process.chdir(dir);
    const result = getUnstagedDiff();
    assert.equal(result.hasChanges, true);
    assert.equal(result.staged, false);
    assert.ok(result.diff.includes('tracked.txt'));
  } finally {
    process.chdir(originalDir);
  }
});

test('commit() commits staged changes and returns hash', () => {
  const dir = createGitRepo();
  createFile(dir, 'test.txt', 'hello');
  gitAdd(dir);
  try {
    process.chdir(dir);
    const result = commit('feat: add test file');
    assert.ok(result.hash, 'commit should return a hash');
    assert.equal(result.hash.length, 7);
    assert.ok(result.summary);
    assert.ok(result.summary.includes('feat: add test file'));
    assert.ok(result.raw.length > 0);
  } finally {
    process.chdir(originalDir);
  }
});

test('commit() with body returns hash and summary', () => {
  const dir = createGitRepo();
  createFile(dir, 'hello.txt', 'world');
  gitAdd(dir);
  try {
    process.chdir(dir);
    const result = commit('feat: add hello', 'This is the body');
    assert.ok(result.hash);
    assert.ok(result.summary.includes('feat: add hello'));
  } finally {
    process.chdir(originalDir);
  }
});

test('getRepoRoot() returns the absolute path', () => {
  const dir = createGitRepo();
  try {
    process.chdir(dir);
    const root = getRepoRoot();
    assert.equal(root, dir);
  } finally {
    process.chdir(originalDir);
  }
});

test('commit() throws with error message when nothing is staged', () => {
  const dir = createGitRepo();
  try {
    process.chdir(dir);
    assert.throws(() => commit('feat: no changes'), /nothing to commit/);
  } finally {
    process.chdir(originalDir);
  }
});
