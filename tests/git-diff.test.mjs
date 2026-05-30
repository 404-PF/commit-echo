import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const diffModuleUrl = pathToFileURL(join(process.cwd(), 'dist', 'git', 'diff.js')).href;

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' });
}

function withGitRepo(fn) {
  const cwd = mkdtempSync(join(tmpdir(), 'commit-echo-diff-'));

  try {
    git(cwd, 'init');
    git(cwd, 'config', 'user.email', 'test@example.com');
    git(cwd, 'config', 'user.name', 'Test User');
    writeFileSync(join(cwd, 'tracked.txt'), 'initial\n', 'utf-8');
    git(cwd, 'add', 'tracked.txt');
    git(cwd, 'commit', '-m', 'initial');

    return fn(cwd);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test('getUnstagedDiff returns trimmed diff metadata for working tree changes', async () => {
  const { getUnstagedDiff } = await import(diffModuleUrl);

  withGitRepo((cwd) => {
    const previousCwd = process.cwd();
    process.chdir(cwd);

    try {
      writeFileSync(join(cwd, 'tracked.txt'), 'initial\nupdated\n', 'utf-8');

      const result = getUnstagedDiff();

      assert.equal(result.hasChanges, true);
      assert.equal(result.staged, false);
      assert.match(result.diff, /\+updated/);
      assert.equal(result.diff, result.diff.trim());
    } finally {
      process.chdir(previousCwd);
    }
  });
});

test('getStagedDiff returns staged diff and ignores unstaged-only changes', async () => {
  const { getStagedDiff } = await import(diffModuleUrl);

  withGitRepo((cwd) => {
    const previousCwd = process.cwd();
    process.chdir(cwd);

    try {
      writeFileSync(join(cwd, 'tracked.txt'), 'initial\nstaged\n', 'utf-8');
      git(cwd, 'add', 'tracked.txt');
      writeFileSync(join(cwd, 'tracked.txt'), 'initial\nstaged\nunstaged\n', 'utf-8');

      const result = getStagedDiff();

      assert.equal(result.hasChanges, true);
      assert.equal(result.staged, true);
      assert.match(result.diff, /\+staged/);
      assert.doesNotMatch(result.diff, /\+unstaged/);
    } finally {
      process.chdir(previousCwd);
    }
  });
});

test('checkGitRepo reports non-repositories and getRepoRoot returns repository root', async () => {
  const { checkGitRepo, getRepoRoot } = await import(diffModuleUrl);

  withGitRepo((cwd) => {
    const nested = join(cwd, 'nested', 'path');
    mkdirSync(nested, { recursive: true });
    const previousCwd = process.cwd();
    process.chdir(nested);

    try {
      assert.doesNotThrow(() => checkGitRepo());
      assert.equal(getRepoRoot(), cwd);
    } finally {
      process.chdir(previousCwd);
    }
  });

  const nonRepo = mkdtempSync(join(tmpdir(), 'commit-echo-nonrepo-'));
  const previousCwd = process.cwd();
  process.chdir(nonRepo);

  try {
    assert.throws(() => checkGitRepo(), /not a git repository/i);
  } finally {
    process.chdir(previousCwd);
    rmSync(nonRepo, { recursive: true, force: true });
  }
});
