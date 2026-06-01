import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildHookCommitMessage,
  buildPrepareCommitMsgHookScript,
  installPrepareCommitMsgHook,
  runPrepareCommitMsgHook,
  shouldSkipPrepareCommitMsgHook,
} from '../dist/git/hook.js';

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: 'pipe',
  });
}

function initRepo() {
  const repoDir = mkdtempSync(join(tmpdir(), 'commit-echo-hook-test-'));

  git(['init'], repoDir);
  git(['config', 'user.name', 'Test User'], repoDir);
  git(['config', 'user.email', 'test@example.com'], repoDir);

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

async function withCwdAsync(dir, fn) {
  const previousCwd = process.cwd();

  try {
    process.chdir(dir);
    return await fn();
  } finally {
    process.chdir(previousCwd);
  }
}

test('shouldSkipPrepareCommitMsgHook skips commit message sources that should not be rewritten', () => {
  assert.equal(shouldSkipPrepareCommitMsgHook(''), false);
  assert.equal(shouldSkipPrepareCommitMsgHook('template'), false);
  assert.equal(shouldSkipPrepareCommitMsgHook('message'), true);
  assert.equal(shouldSkipPrepareCommitMsgHook('merge'), true);
  assert.equal(shouldSkipPrepareCommitMsgHook('squash'), true);
  assert.equal(shouldSkipPrepareCommitMsgHook('commit'), true);
});

test('buildHookCommitMessage preserves commit template comments', () => {
  const result = buildHookCommitMessage(
    { index: 1, message: 'feat: add hook support', body: 'Explain the change.' },
    '# Please enter the commit message for your changes.\n\n# Lines starting with # will be ignored.'
  );

  assert.ok(result.startsWith('feat: add hook support\n\nExplain the change.'));
  assert.ok(result.includes('# Please enter the commit message for your changes.'));
  assert.ok(result.includes('# Lines starting with # will be ignored.'));
});

test('buildPrepareCommitMsgHookScript points to the CLI entry point and optional backup', () => {
  const script = buildPrepareCommitMsgHookScript('c:\\tools\\commit-echo\\dist\\index.js', 'c:\\repo\\.git\\hooks\\prepare-commit-msg.commit-echo.bak');

  assert.match(script, /node "c:\/tools\/commit-echo\/dist\/index.js" hook "\$@"/);
  assert.match(script, /sh "c:\/repo\/\.git\/hooks\/prepare-commit-msg.commit-echo.bak" "\$@"/);
});

test('installPrepareCommitMsgHook writes a managed hook file inside the current repository', async () => {
  const repoDir = initRepo();

  try {
    await withCwdAsync(repoDir, async () => {
      const resolvedHookPath = await installPrepareCommitMsgHook(join(repoDir, 'dist', 'index.js'));
      assert.ok(existsSync(resolvedHookPath));
      const content = readFileSync(resolvedHookPath, 'utf-8');
      assert.match(content, /commit-echo managed prepare-commit-msg hook/);
      assert.match(content, /node ".*dist\/index\.js" hook "\$@"/);
    });
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('runPrepareCommitMsgHook rewrites the message file with the first suggestion', async () => {
  const repoDir = mkdtempSync(join(tmpdir(), 'commit-echo-hook-run-'));
  const messageFile = join(repoDir, 'COMMIT_EDITMSG');
  writeFileSync(messageFile, '# comment line\n', 'utf-8');

  try {
    const deps = {
      checkGitRepo: () => {},
      loadConfig: async () => ({
        provider: 'mock',
        model: 'mock-model',
        historySize: 3,
        maxDiffSize: 4000,
      }),
      getStagedDiff: () => ({ diff: 'diff --git a/file b/file\n+hello', hasChanges: true, staged: true }),
      buildProfile: async () => ({
        avgLength: 0,
        commonPrefixes: [],
        prefixRates: {},
        imperativeRate: 0,
        sentenceCaseRate: 0,
        usesScopeRate: 0,
        usesBodyRate: 0,
        totalCommits: 0,
      }),
      generateSuggestions: async () => ({
        suggestions: [{ index: 1, message: 'feat: prefill hook', body: 'Hook body' }],
        profile: {
          avgLength: 0,
          commonPrefixes: [],
          prefixRates: {},
          imperativeRate: 0,
          sentenceCaseRate: 0,
          usesScopeRate: 0,
          usesBodyRate: 0,
          totalCommits: 0,
        },
        model: 'mock-model',
      }),
      readMessageFile: async (filePath) => readFileSync(filePath, 'utf-8'),
      writeMessageFile: async (filePath, content) => writeFileSync(filePath, content, 'utf-8'),
      warn: () => {},
    };

    await runPrepareCommitMsgHook({ messageFile, source: 'template' }, deps);

    const result = readFileSync(messageFile, 'utf-8');
    assert.ok(result.startsWith('feat: prefill hook\n\nHook body'));
    assert.ok(result.includes('# comment line'));
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('runPrepareCommitMsgHook leaves amend and merge sources unchanged', async () => {
  const repoDir = mkdtempSync(join(tmpdir(), 'commit-echo-hook-skip-'));
  const messageFile = join(repoDir, 'COMMIT_EDITMSG');
  writeFileSync(messageFile, 'original\n', 'utf-8');

  try {
    let called = false;
    const deps = {
      checkGitRepo: () => {},
      loadConfig: async () => ({
        provider: 'mock',
        model: 'mock-model',
        historySize: 3,
        maxDiffSize: 4000,
      }),
      getStagedDiff: () => ({ diff: 'diff --git a/file b/file\n+hello', hasChanges: true, staged: true }),
      buildProfile: async () => ({
        avgLength: 0,
        commonPrefixes: [],
        prefixRates: {},
        imperativeRate: 0,
        sentenceCaseRate: 0,
        usesScopeRate: 0,
        usesBodyRate: 0,
        totalCommits: 0,
      }),
      generateSuggestions: async () => {
        called = true;
        return {
          suggestions: [{ index: 1, message: 'feat: should not be used' }],
          profile: {
            avgLength: 0,
            commonPrefixes: [],
            prefixRates: {},
            imperativeRate: 0,
            sentenceCaseRate: 0,
            usesScopeRate: 0,
            usesBodyRate: 0,
            totalCommits: 0,
          },
          model: 'mock-model',
        };
      },
      readMessageFile: async (filePath) => readFileSync(filePath, 'utf-8'),
      writeMessageFile: async (filePath, content) => writeFileSync(filePath, content, 'utf-8'),
      warn: () => {},
    };

    await runPrepareCommitMsgHook({ messageFile, source: 'merge' }, deps);

    assert.equal(called, false);
    assert.equal(readFileSync(messageFile, 'utf-8'), 'original\n');
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});