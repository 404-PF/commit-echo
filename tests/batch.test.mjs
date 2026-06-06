import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  findGitRepositories,
  gitHasChanges,
  getGitDiff,
} from '../dist/commands/batch.js';

function createTempDir() {
  return realpathSync.native(
    mkdtempSync(join(tmpdir(), 'commit-echo-batch-test-')),
  );
}

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: 'pipe',
  });
}

function initRepo(root, name) {
  const repoDir = join(root, name);
  mkdirSync(repoDir, { recursive: true });
  git(['init'], repoDir);
  git(['config', 'core.fsmonitor', 'false'], repoDir);
  git(['config', 'user.name', 'Test User'], repoDir);
  git(['config', 'user.email', 'test@example.com'], repoDir);

  return repoDir;
}

// ─── findGitRepositories ────────────────────────────────────────────────────

test('findGitRepositories returns repos in a flat directory', () => {
  const root = createTempDir();
  try {
    const repoA = initRepo(root, 'repo-a');
    const repoB = initRepo(root, 'repo-b');
    const repos = findGitRepositories(root, false);

    assert.equal(repos.length, 2);
    assert.ok(repos.includes(repoA));
    assert.ok(repos.includes(repoB));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('findGitRepositories ignores hidden directories', () => {
  const root = createTempDir();
  try {
    const repo = initRepo(root, 'visible-repo');
    mkdirSync(join(root, '.hidden'), { recursive: true });
    const repos = findGitRepositories(root, false);

    assert.equal(repos.length, 1);
    assert.equal(repos[0], repo);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('findGitRepositories non-recursive does not descend into subdirectories', () => {
  const root = createTempDir();
  try {
    const topRepo = initRepo(root, 'top-repo');
    const nestedDir = join(root, 'nested');
    mkdirSync(nestedDir, { recursive: true });
    const nestedRepo = initRepo(nestedDir, 'inner-repo');

    const flat = findGitRepositories(root, false);
    assert.equal(flat.length, 1);
    assert.equal(flat[0], topRepo);

    const recursive = findGitRepositories(root, true);
    assert.equal(recursive.length, 2);
    assert.ok(recursive.includes(topRepo));
    assert.ok(recursive.includes(nestedRepo));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('findGitRepositories returns empty array for non-existent directory', () => {
  const repos = findGitRepositories('/path/does/not/exist', false);
  assert.deepEqual(repos, []);
});

test('findGitRepositories returns empty array for directory with no repos', () => {
  const root = createTempDir();
  try {
    mkdirSync(join(root, 'plain-dir'), { recursive: true });
    const repos = findGitRepositories(root, false);
    assert.deepEqual(repos, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('findGitRepositories sorts results alphabetically', () => {
  const root = createTempDir();
  try {
    const repoB = initRepo(root, 'b-repo');
    const repoA = initRepo(root, 'a-repo');
    const repoC = initRepo(root, 'c-repo');

    const repos = findGitRepositories(root, false);
    assert.equal(repos.length, 3);
    assert.equal(repos[0], repoA);
    assert.equal(repos[1], repoB);
    assert.equal(repos[2], repoC);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ─── gitHasChanges ──────────────────────────────────────────────────────────

test('gitHasChanges detects staged changes', () => {
  const root = createTempDir();
  try {
    const repo = initRepo(root, 'repo');
    writeFileSync(join(repo, 'file.txt'), 'content\n', 'utf-8');
    git(['add', 'file.txt'], repo);

    const { staged, unstaged } = gitHasChanges(repo);
    assert.equal(staged, true);
    assert.equal(unstaged, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('gitHasChanges detects unstaged changes', () => {
  const root = createTempDir();
  try {
    const repo = initRepo(root, 'repo');
    // Create a tracked file first, then modify it
    writeFileSync(join(repo, 'file.txt'), 'initial\n', 'utf-8');
    git(['add', 'file.txt'], repo);
    git(['commit', '-m', 'feat: initial'], repo);
    writeFileSync(join(repo, 'file.txt'), 'modified\n', 'utf-8');

    const { staged, unstaged } = gitHasChanges(repo);
    assert.equal(staged, false);
    assert.equal(unstaged, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('gitHasChanges returns false for clean repo', () => {
  const root = createTempDir();
  try {
    const repo = initRepo(root, 'repo');
    writeFileSync(join(repo, 'file.txt'), 'content\n', 'utf-8');
    git(['add', 'file.txt'], repo);
    git(['commit', '-m', 'feat: initial'], repo);

    const { staged, unstaged } = gitHasChanges(repo);
    assert.equal(staged, false);
    assert.equal(unstaged, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('gitHasChanges detects both staged and unstaged', () => {
  const root = createTempDir();
  try {
    const repo = initRepo(root, 'repo');
    // Create a tracked file
    writeFileSync(join(repo, 'tracked.txt'), 'base\n', 'utf-8');
    git(['add', 'tracked.txt'], repo);
    git(['commit', '-m', 'feat: initial'], repo);
    // Modify and stage it
    writeFileSync(join(repo, 'tracked.txt'), 'staged change\n', 'utf-8');
    git(['add', 'tracked.txt'], repo);
    // Modify again (unstaged)
    writeFileSync(join(repo, 'tracked.txt'), 'staged + unstaged\n', 'utf-8');

    const { staged, unstaged } = gitHasChanges(repo);
    assert.equal(staged, true);
    assert.equal(unstaged, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ─── getGitDiff ─────────────────────────────────────────────────────────────

test('getGitDiff returns the staged diff', () => {
  const root = createTempDir();
  try {
    const repo = initRepo(root, 'repo');
    writeFileSync(join(repo, 'file.txt'), 'hello\n', 'utf-8');
    git(['add', 'file.txt'], repo);

    const diff = getGitDiff(repo, true);
    assert.match(diff, /diff --git/);
    assert.match(diff, /\+hello/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('getGitDiff returns the unstaged diff', () => {
  const root = createTempDir();
  try {
    const repo = initRepo(root, 'repo');
    writeFileSync(join(repo, 'file.txt'), 'initial\n', 'utf-8');
    git(['add', 'file.txt'], repo);
    git(['commit', '-m', 'feat: initial'], repo);
    writeFileSync(join(repo, 'file.txt'), 'modified\n', 'utf-8');

    const diff = getGitDiff(repo, false);
    assert.match(diff, /diff --git/);
    assert.match(diff, /-initial/);
    assert.match(diff, /\+modified/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('getGitDiff throws when not in a git repo', () => {
  const root = createTempDir();
  try {
    assert.throws(() => getGitDiff(root, true), /Failed to get diff/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
