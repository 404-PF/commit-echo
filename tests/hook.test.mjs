import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';

import {
  buildHookCommitMessage,
  buildPostCommitHookScript,
  buildPrepareCommitMsgHookScript,
  installCommitHooks,
  installPrepareCommitMsgHook,
  uninstallCommitHooks,
  runPostCommitHook,
  runPrepareCommitMsgHook,
  shouldSkipPrepareCommitMsgHook,
} from '../dist/git/hook.js';

const MOCK_PROFILE = {
  avgLength: 0,
  commonPrefixes: [],
  prefixRates: {},
  imperativeRate: 0,
  sentenceCaseRate: 0,
  usesScopeRate: 0,
  usesBodyRate: 0,
  totalCommits: 0,
};

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
    '# Please enter the commit message for your changes.\n\n# Lines starting with # will be ignored.',
  );

  assert.ok(result.startsWith('feat: add hook support\n\nExplain the change.'));
  assert.ok(result.includes('# Please enter the commit message for your changes.'));
  assert.ok(result.includes('# Lines starting with # will be ignored.'));
});

test('buildHookCommitMessage preserves non-comment template content', () => {
  const result = buildHookCommitMessage(
    { index: 1, message: 'feat: add hook support', body: 'Explain the change.' },
    'Ticket: ABC-123\n\nDetails:\n- add tests\n# comment',
  );

  assert.ok(result.startsWith('feat: add hook support\n\nExplain the change.'));
  assert.ok(result.includes('Ticket: ABC-123'));
  assert.ok(result.includes('Details:'));
  assert.ok(result.includes('# comment'));
});

test('buildHookCommitMessage preserves template whitespace exactly', () => {
  const template = '\nTicket: ABC-123\n\nDetails:\n- add tests\n# comment\n\n';
  const result = buildHookCommitMessage(
    { index: 1, message: 'feat: add hook support', body: 'Explain the change.' },
    template,
  );

  assert.equal(result, `feat: add hook support\n\nExplain the change.\n\n${template}`);
});

test('buildPrepareCommitMsgHookScript chains backup hook with direct exec and shell fallback', () => {
  const script = buildPrepareCommitMsgHookScript(
    'c:\\tools\\commit-echo\\dist\\index.js',
    'c:\\repo\\.git\\hooks\\prepare-commit-msg.commit-echo.bak',
  );

  assert.match(
    script,
    /if \[ -f 'c:\/repo\/\.git\/hooks\/prepare-commit-msg.commit-echo\.bak' \][\s\S]*if command -v commit-echo >\/dev\/null 2>&1; then commit-echo hook 'prepare-commit-msg' "\$@"; elif \[ -f 'c:\/tools\/commit-echo\/dist\/index\.js' \]; then node 'c:\/tools\/commit-echo\/dist\/index\.js' hook 'prepare-commit-msg' "\$@"; fi/,
  );
  assert.match(
    script,
    /if command -v commit-echo >\/dev\/null 2>&1; then commit-echo hook 'prepare-commit-msg' "\$@"; elif \[ -f 'c:\/tools\/commit-echo\/dist\/index\.js' \]; then node 'c:\/tools\/commit-echo\/dist\/index\.js' hook 'prepare-commit-msg' "\$@"; fi/,
  );
  assert.match(
    script,
    /if \[ -x 'c:\/repo\/\.git\/hooks\/prepare-commit-msg\.commit-echo.bak' \]; then 'c:\/repo\/\.git\/hooks\/prepare-commit-msg.commit-echo.bak' "\$@" \|\| exit \$\?; else sh 'c:\/repo\/\.git\/hooks\/prepare-commit-msg.commit-echo.bak' "\$@" \|\| exit \$\?; fi/,
  );
});

test('buildPostCommitHookScript invokes the post-commit entry point', () => {
  const script = buildPostCommitHookScript(
    'c:\\tools\\commit-echo\\dist\\index.js',
    'c:\\repo\\.git\\hooks\\post-commit.commit-echo.bak',
  );

  assert.match(script, /commit-echo managed hook post-commit/);
  assert.match(
    script,
    /if command -v commit-echo >\/dev\/null 2>&1; then commit-echo hook 'post-commit' "\$@"; elif \[ -f 'c:\/tools\/commit-echo\/dist\/index\.js' \]; then node 'c:\/tools\/commit-echo\/dist\/index\.js' hook 'post-commit' "\$@"; fi/,
  );
});

test('buildPrepareCommitMsgHookScript safely quotes paths containing shell metacharacters', () => {
  const script = buildPrepareCommitMsgHookScript("/tmp/commit-echo/it's/$(bad)/index.js");

  assert.match(
    script,
    /if command -v commit-echo >\/dev\/null 2>&1; then commit-echo hook 'prepare-commit-msg' "\$@"; elif \[ -f '\/tmp\/commit-echo\/it'"'"'s\/\$\(bad\)\/index\.js' \]; then node '\/tmp\/commit-echo\/it'"'"'s\/\$\(bad\)\/index\.js' hook 'prepare-commit-msg' "\$@";/,
  );
});

test('installPrepareCommitMsgHook writes a managed hook file inside the current repository', async () => {
  const repoDir = initRepo();

  try {
    await withCwdAsync(repoDir, async () => {
      const resolvedHookPath = await installPrepareCommitMsgHook(join(repoDir, 'dist', 'index.js'));
      assert.ok(existsSync(resolvedHookPath));
      assert.equal(isAbsolute(resolvedHookPath), true);
      assert.equal(resolvedHookPath, realpathSync(join(repoDir, '.git', 'hooks', 'prepare-commit-msg')));
      const content = readFileSync(resolvedHookPath, 'utf-8');
      const postCommitHookPath = join(repoDir, '.git', 'hooks', 'post-commit');
      assert.match(content, /commit-echo managed hook prepare-commit-msg/);
      assert.match(content, /node '.*dist\/index\.js' hook 'prepare-commit-msg' "\$@"/);
      assert.ok(existsSync(postCommitHookPath));
      assert.match(readFileSync(postCommitHookPath, 'utf-8'), /hook 'post-commit' "\$@"/);
    });
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('installCommitHooks preserves existing hooks and uninstall restores them', async () => {
  const repoDir = initRepo();
  const hooksDir = join(repoDir, '.git', 'hooks');
  const originalPrepare = '#!/bin/sh\necho original prepare\n';
  const originalPost = '#!/bin/sh\necho original post\n';
  const originalPreparePath = join(hooksDir, 'prepare-commit-msg');
  const originalPostPath = join(hooksDir, 'post-commit');
  writeFileSync(originalPreparePath, originalPrepare, 'utf-8');
  writeFileSync(originalPostPath, originalPost, 'utf-8');
  chmodSync(originalPreparePath, 0o640);
  chmodSync(originalPostPath, 0o750);

  try {
    await withCwdAsync(repoDir, async () => {
      await installCommitHooks(join(repoDir, 'dist', 'index.js'));

      const prepareBackup = join(hooksDir, 'prepare-commit-msg.commit-echo.bak');
      const postBackup = join(hooksDir, 'post-commit.commit-echo.bak');
      assert.equal(readFileSync(prepareBackup, 'utf-8'), originalPrepare);
      assert.equal(readFileSync(postBackup, 'utf-8'), originalPost);

      await installCommitHooks(join(repoDir, 'dist', 'index.js'));
      assert.equal(readFileSync(prepareBackup, 'utf-8'), originalPrepare);
      assert.equal(readFileSync(postBackup, 'utf-8'), originalPost);

      const result = await uninstallCommitHooks();
      assert.equal(result.restored.length, 2);
      assert.equal(result.removed.length, 0);
      assert.equal(result.skipped.length, 0);
      assert.equal(readFileSync(join(hooksDir, 'prepare-commit-msg'), 'utf-8'), originalPrepare);
      assert.equal(readFileSync(join(hooksDir, 'post-commit'), 'utf-8'), originalPost);
      assert.equal(existsSync(prepareBackup), false);
      assert.equal(existsSync(postBackup), false);
      if (process.platform !== 'win32') {
        assert.equal(statSync(originalPreparePath).mode & 0o7777, 0o640);
        assert.equal(statSync(originalPostPath).mode & 0o7777, 0o750);
      }
    });
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('installCommitHooks preserves empty and whitespace-only replacement hooks', async () => {
  const repoDir = initRepo();
  const hooksDir = join(repoDir, '.git', 'hooks');
  const preparePath = join(hooksDir, 'prepare-commit-msg');
  const postPath = join(hooksDir, 'post-commit');
  const prepareBackupPath = `${preparePath}.commit-echo.bak`;
  const postBackupPath = `${postPath}.commit-echo.bak`;
  writeFileSync(preparePath, '#!/bin/sh\necho original prepare\n', 'utf-8');
  writeFileSync(postPath, '#!/bin/sh\necho original post\n', 'utf-8');

  try {
    await withCwdAsync(repoDir, async () => {
      await installCommitHooks(join(repoDir, 'dist', 'index.js'));

      const emptyPrepare = '';
      const whitespaceOnlyPost = ' \n\t ';
      writeFileSync(preparePath, emptyPrepare, 'utf-8');
      writeFileSync(postPath, whitespaceOnlyPost, 'utf-8');

      await installCommitHooks(join(repoDir, 'dist', 'index.js'));
      assert.equal(readFileSync(prepareBackupPath, 'utf-8'), emptyPrepare);
      assert.equal(readFileSync(postBackupPath, 'utf-8'), whitespaceOnlyPost);

      const result = await uninstallCommitHooks();
      assert.equal(result.restored.length, 2);
      assert.equal(result.removed.length, 0);
      assert.equal(readFileSync(preparePath, 'utf-8'), emptyPrepare);
      assert.equal(readFileSync(postPath, 'utf-8'), whitespaceOnlyPost);
      assert.equal(existsSync(prepareBackupPath), false);
      assert.equal(existsSync(postBackupPath), false);
    });
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('installCommitHooks preserves and restores symlink hooks', { skip: process.platform === 'win32' }, async () => {
  const repoDir = initRepo();
  const hooksDir = join(repoDir, '.git', 'hooks');
  const sharedHooksDir = join(repoDir, 'shared-hooks');
  const targetPath = join(sharedHooksDir, 'prepare-commit-msg');
  const replacementTargetPath = join(sharedHooksDir, 'replacement-prepare-commit-msg');
  const hookPath = join(hooksDir, 'prepare-commit-msg');
  const backupPath = `${hookPath}.commit-echo.bak`;
  const original = '#!/bin/sh\necho shared hook\n';
  const replacement = '#!/bin/sh\necho replacement hook\n';
  mkdirSync(sharedHooksDir, { recursive: true });
  writeFileSync(targetPath, original, 'utf-8');
  writeFileSync(replacementTargetPath, replacement, 'utf-8');
  symlinkSync(targetPath, hookPath, 'file');

  try {
    await withCwdAsync(repoDir, async () => {
      await installCommitHooks(join(repoDir, 'dist', 'index.js'));

      assert.equal(readFileSync(targetPath, 'utf-8'), original);
      assert.equal(lstatSync(hookPath).isSymbolicLink(), false);
      assert.equal(lstatSync(backupPath).isSymbolicLink(), true);
      assert.equal(readlinkSync(backupPath), targetPath);

      rmSync(hookPath);
      symlinkSync(replacementTargetPath, hookPath, 'file');
      await installCommitHooks(join(repoDir, 'dist', 'index.js'));

      assert.equal(readFileSync(replacementTargetPath, 'utf-8'), replacement);
      assert.equal(lstatSync(backupPath).isSymbolicLink(), true);
      assert.equal(readlinkSync(backupPath), replacementTargetPath);

      const result = await uninstallCommitHooks();
      assert.equal(result.restored.length, 1);
      assert.equal(result.removed.length, 1);
      assert.equal(lstatSync(hookPath).isSymbolicLink(), true);
      assert.equal(readlinkSync(hookPath), replacementTargetPath);
      assert.equal(readFileSync(targetPath, 'utf-8'), original);
      assert.equal(readFileSync(replacementTargetPath, 'utf-8'), replacement);
      assert.equal(existsSync(backupPath), false);
    });
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test(
  'uninstallCommitHooks preserves an unreadable replacement and its backup',
  { skip: process.platform === 'win32' },
  async () => {
    const repoDir = initRepo();
    const hooksDir = join(repoDir, '.git', 'hooks');
    const originalPrepare = '#!/bin/sh\necho unreadable original\n';
    const originalPreparePath = join(hooksDir, 'prepare-commit-msg');
    const missingReplacementTarget = join(repoDir, 'missing-prepare-hook');
    const backupPath = `${originalPreparePath}.commit-echo.bak`;
    writeFileSync(originalPreparePath, originalPrepare, 'utf-8');
    chmodSync(originalPreparePath, 0o640);

    try {
      await withCwdAsync(repoDir, async () => {
        await installCommitHooks(join(repoDir, 'dist', 'index.js'));
        rmSync(originalPreparePath);
        symlinkSync(missingReplacementTarget, originalPreparePath, 'file');

        const result = await uninstallCommitHooks();
        assert.equal(result.restored.length, 0);
        assert.equal(result.removed.length, 1);
        assert.equal(result.skipped.length, 0);
        assert.equal(result.unreadable.length, 1);
        assert.equal(lstatSync(originalPreparePath).isSymbolicLink(), true);
        assert.equal(existsSync(backupPath), true);
      });
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  },
);

test('installCommitHooks rejects an unowned backup collision and rolls back the other hook', async () => {
  const repoDir = initRepo();
  const hooksDir = join(repoDir, '.git', 'hooks');
  const preparePath = join(hooksDir, 'prepare-commit-msg');
  const backupPath = `${preparePath}.commit-echo.bak`;
  const originalHook = '#!/bin/sh\necho existing hook\n';
  const existingBackup = '#!/bin/sh\necho unrelated backup\n';
  writeFileSync(preparePath, originalHook, 'utf-8');
  writeFileSync(backupPath, existingBackup, 'utf-8');

  try {
    await withCwdAsync(repoDir, async () => {
      await assert.rejects(
        () => installCommitHooks(join(repoDir, 'dist', 'index.js')),
        /Refusing to overwrite existing backup/,
      );
      assert.equal(readFileSync(preparePath, 'utf-8'), originalHook);
      assert.equal(readFileSync(backupPath, 'utf-8'), existingBackup);
      assert.equal(existsSync(join(hooksDir, 'post-commit')), false);
    });
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('uninstallCommitHooks restores an owned backup after a truncated managed hook', async () => {
  const repoDir = initRepo();
  const hooksDir = join(repoDir, '.git', 'hooks');
  const preparePath = join(hooksDir, 'prepare-commit-msg');
  const originalPrepare = '#!/bin/sh\necho original prepare\n';
  writeFileSync(preparePath, originalPrepare, 'utf-8');

  try {
    await withCwdAsync(repoDir, async () => {
      await installCommitHooks(join(repoDir, 'dist', 'index.js'));
      writeFileSync(preparePath, '', 'utf-8');

      const result = await uninstallCommitHooks();
      assert.equal(result.restored.length, 1);
      assert.equal(readFileSync(preparePath, 'utf-8'), originalPrepare);
      assert.equal(existsSync(`${preparePath}.commit-echo.bak`), false);
    });
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test(
  'uninstallCommitHooks isolates an unreadable backup from the other hook',
  async () => {
    const repoDir = initRepo();
    const hooksDir = join(repoDir, '.git', 'hooks');
    const preparePath = join(hooksDir, 'prepare-commit-msg');
    const backupPath = `${preparePath}.commit-echo.bak`;
    writeFileSync(preparePath, '#!/bin/sh\necho original\n', 'utf-8');

    try {
      await withCwdAsync(repoDir, async () => {
        await installCommitHooks(join(repoDir, 'dist', 'index.js'));
        rmSync(backupPath);
        mkdirSync(backupPath);

        const result = await uninstallCommitHooks();
        assert.equal(result.restored.length, 0);
        assert.equal(result.removed.length, 1);
        assert.equal(result.unreadable.length, 1);
        assert.match(readFileSync(preparePath, 'utf-8'), /commit-echo managed hook/);
        assert.equal(existsSync(backupPath), true);
        assert.equal(existsSync(join(hooksDir, 'post-commit')), false);
      });
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  },
);

test('init --uninstall-hook exits non-zero when a hook is unreadable', async () => {
  const repoDir = initRepo();
  const hooksDir = join(repoDir, '.git', 'hooks');
  const preparePath = join(hooksDir, 'prepare-commit-msg');
  const backupPath = `${preparePath}.commit-echo.bak`;
  const cliPath = join(process.cwd(), 'dist', 'index.js');
  writeFileSync(preparePath, '#!/bin/sh\necho original\n', 'utf-8');

  try {
    await withCwdAsync(repoDir, async () => {
      await installCommitHooks(cliPath);
      rmSync(backupPath);
      mkdirSync(backupPath);

      const result = spawnSync(process.execPath, [cliPath, 'init', '--uninstall-hook'], {
        cwd: repoDir,
        encoding: 'utf-8',
        env: { ...process.env, NO_COLOR: '1' },
      });

      assert.equal(result.status, 1, result.stderr);
      assert.match(`${result.stdout}\n${result.stderr}`, /Could not inspect 1 hook/);
    });
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('uninstallCommitHooks removes hooks created by commit-echo without deleting user hooks', async () => {
  const repoDir = initRepo();
  const hooksDir = join(repoDir, '.git', 'hooks');

  try {
    await withCwdAsync(repoDir, async () => {
      await installCommitHooks(join(repoDir, 'dist', 'index.js'));
      const userPrepare = '#!/bin/sh\necho user replacement\n';
      writeFileSync(join(hooksDir, 'prepare-commit-msg'), userPrepare, 'utf-8');

      const result = await uninstallCommitHooks();
      assert.equal(result.restored.length, 0);
      assert.equal(result.removed.length, 1);
      assert.equal(result.skipped.length, 1);
      assert.equal(readFileSync(join(hooksDir, 'prepare-commit-msg'), 'utf-8'), userPrepare);
      assert.equal(existsSync(join(hooksDir, 'post-commit')), false);
      assert.equal(existsSync(join(hooksDir, 'prepare-commit-msg.commit-echo.bak')), false);

      await installCommitHooks(join(repoDir, 'dist', 'index.js'));
      assert.equal(readFileSync(join(hooksDir, 'prepare-commit-msg.commit-echo.bak'), 'utf-8'), userPrepare);
    });
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('uninstallCommitHooks does not treat marker text in a user hook as ownership', async () => {
  const repoDir = initRepo();
  const hooksDir = join(repoDir, '.git', 'hooks');
  const preparePath = join(hooksDir, 'prepare-commit-msg');
  const userPrepare = '#!/bin/sh\necho user replacement\n# commit-echo managed hook prepare-commit-msg\n';

  try {
    await withCwdAsync(repoDir, async () => {
      await installCommitHooks(join(repoDir, 'dist', 'index.js'));
      writeFileSync(preparePath, userPrepare, 'utf-8');

      const result = await uninstallCommitHooks();
      assert.equal(result.restored.length, 0);
      assert.equal(result.removed.length, 1);
      assert.equal(result.skipped.length, 1);
      assert.equal(readFileSync(preparePath, 'utf-8'), userPrepare);
      assert.equal(existsSync(`${preparePath}.commit-echo.bak`), false);
    });
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('uninstallCommitHooks restores legacy relative backups from a different working directory', async () => {
  const repoDir = initRepo();
  const nestedDir = join(repoDir, 'nested', 'deep');
  mkdirSync(nestedDir, { recursive: true });
  const hooksDir = join(repoDir, '.git', 'hooks');
  const preparePath = join(hooksDir, 'prepare-commit-msg');
  const backupPath = `${preparePath}.commit-echo.bak`;
  const ownerPath = `${backupPath}.owner`;
  const originalPrepare = '#!/bin/sh\necho original prepare\n';
  writeFileSync(preparePath, originalPrepare, 'utf-8');

  try {
    await withCwdAsync(nestedDir, async () => {
      await installCommitHooks(join(repoDir, 'dist', 'index.js'));
      const legacyBackupPath = git(
        ['rev-parse', '--git-path', 'hooks/prepare-commit-msg.commit-echo.bak'],
        nestedDir,
      ).trim();
      const managedHook = readFileSync(preparePath, 'utf-8');
      const absoluteBackupPath = backupPath.replace(/\\/g, '/');
      const legacyPath = legacyBackupPath.replace(/\\/g, '/');

      assert.equal(isAbsolute(legacyBackupPath), false);
      assert.ok(managedHook.includes(absoluteBackupPath));
      writeFileSync(preparePath, managedHook.replaceAll(absoluteBackupPath, legacyPath), 'utf-8');
      rmSync(ownerPath);
    });

    await withCwdAsync(repoDir, async () => {
      const result = await uninstallCommitHooks();
      assert.equal(result.restored.length, 1);
      assert.equal(result.removed.length, 1);
      assert.equal(readFileSync(preparePath, 'utf-8'), originalPrepare);
      assert.equal(existsSync(backupPath), false);
    });
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('uninstallCommitHooks does not classify missing hooks as skipped user hooks', async () => {
  const repoDir = initRepo();

  try {
    await withCwdAsync(repoDir, async () => {
      const result = await uninstallCommitHooks();
      assert.equal(result.restored.length, 0);
      assert.equal(result.removed.length, 0);
      assert.equal(result.skipped.length, 0);
      assert.equal(result.missing.length, 2);
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
      buildProfile: async () => MOCK_PROFILE,
      generateSuggestions: async () => ({
        suggestions: [{ index: 1, message: 'feat: prefill hook', body: 'Hook body' }],
        profile: MOCK_PROFILE,
        model: 'mock-model',
      }),
      readMessageFile: async (filePath) => readFileSync(filePath, 'utf-8'),
      writeMessageFile: async (filePath, content) => writeFileSync(filePath, content, 'utf-8'),
      writePendingEntryFile: async () => {},
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

test('runPrepareCommitMsgHook leaves merge and commit sources unchanged', async () => {
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
      buildProfile: async () => MOCK_PROFILE,
      generateSuggestions: async () => {
        called = true;
        return {
          suggestions: [{ index: 1, message: 'feat: should not be used' }],
          profile: MOCK_PROFILE,
          model: 'mock-model',
        };
      },
      readMessageFile: async (filePath) => readFileSync(filePath, 'utf-8'),
      writeMessageFile: async (filePath, content) => writeFileSync(filePath, content, 'utf-8'),
      writePendingEntryFile: async () => {},
      warn: () => {},
    };

    await runPrepareCommitMsgHook({ messageFile, source: 'merge' }, deps);
    assert.equal(called, false);
    assert.equal(readFileSync(messageFile, 'utf-8'), 'original\n');

    await runPrepareCommitMsgHook({ messageFile, source: 'commit' }, deps);
    assert.equal(called, false);
    assert.equal(readFileSync(messageFile, 'utf-8'), 'original\n');
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('runPrepareCommitMsgHook clears stale pending state for skipped sources', async () => {
  const repoDir = mkdtempSync(join(tmpdir(), 'commit-echo-hook-stale-'));
  const messageFile = join(repoDir, 'COMMIT_EDITMSG');
  writeFileSync(messageFile, '', 'utf-8');

  try {
    let pendingEntry = '';
    const deps = {
      checkGitRepo: () => {},
      loadConfig: async () => ({
        provider: 'mock',
        model: 'mock-model',
        historySize: 3,
        maxDiffSize: 4000,
      }),
      getStagedDiff: () => ({ diff: 'diff --git a/file b/file\n+hello', hasChanges: true, staged: true }),
      buildProfile: async () => MOCK_PROFILE,
      generateSuggestions: async () => ({
        suggestions: [{ index: 1, message: 'feat: stale pending', body: 'Hook body' }],
        profile: MOCK_PROFILE,
        model: 'mock-model',
      }),
      readMessageFile: async (filePath) => readFileSync(filePath, 'utf-8'),
      writeMessageFile: async (filePath, content) => writeFileSync(filePath, content, 'utf-8'),
      writePendingEntryFile: async (content) => {
        pendingEntry = content;
      },
      removePendingEntryFile: async () => {
        pendingEntry = '';
      },
      warn: () => {},
    };

    await runPrepareCommitMsgHook({ messageFile, source: 'template' }, deps);
    assert.notEqual(pendingEntry, '');

    await runPrepareCommitMsgHook({ messageFile, source: 'message' }, deps);
    assert.equal(pendingEntry, '');

    let historyEntry = '';
    await runPostCommitHook({
      checkGitRepo: () => {},
      readLatestCommitMessage: () => 'fix: manual message',
      readPendingEntryFile: async () => pendingEntry,
      appendHistoryEntry: async (entry) => {
        historyEntry = entry;
      },
      removePendingEntryFile: async () => {
        pendingEntry = '';
      },
      warn: () => {},
    });

    assert.equal(historyEntry, '');
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('runPrepareCommitMsgHook stores a pending history entry for post-commit', async () => {
  const repoDir = mkdtempSync(join(tmpdir(), 'commit-echo-hook-pending-'));
  const messageFile = join(repoDir, 'COMMIT_EDITMSG');
  writeFileSync(messageFile, '', 'utf-8');

  try {
    let pendingEntry = '';
    const deps = {
      checkGitRepo: () => {},
      loadConfig: async () => ({
        provider: 'mock',
        model: 'mock-model',
        historySize: 3,
        maxDiffSize: 4000,
      }),
      getStagedDiff: () => ({ diff: 'diff --git a/file b/file\n+hello', hasChanges: true, staged: true }),
      buildProfile: async () => MOCK_PROFILE,
      generateSuggestions: async () => ({
        suggestions: [{ index: 1, message: 'feat: prefill hook', body: 'Hook body' }],
        profile: MOCK_PROFILE,
        model: 'mock-model',
      }),
      readMessageFile: async (filePath) => readFileSync(filePath, 'utf-8'),
      writeMessageFile: async (filePath, content) => writeFileSync(filePath, content, 'utf-8'),
      writePendingEntryFile: async (content) => {
        pendingEntry = content;
      },
      warn: () => {},
    };

    await runPrepareCommitMsgHook({ messageFile, source: 'template' }, deps);

    assert.match(pendingEntry, /"diff":"diff --git a\/file b\/file\\n\+hello"/);
    assert.match(pendingEntry, /"model":"mock-model"/);
    assert.match(pendingEntry, /"provider":"mock"/);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('runPrepareCommitMsgHook clears stale pending state when suggestion generation fails', async () => {
  const repoDir = mkdtempSync(join(tmpdir(), 'commit-echo-hook-error-'));
  const messageFile = join(repoDir, 'COMMIT_EDITMSG');
  writeFileSync(messageFile, '', 'utf-8');

  try {
    let pendingEntry = 'stale';
    const deps = {
      checkGitRepo: () => {},
      loadConfig: async () => ({
        provider: 'mock',
        model: 'mock-model',
        historySize: 3,
        maxDiffSize: 4000,
      }),
      getStagedDiff: () => ({ diff: 'diff --git a/file b/file\n+hello', hasChanges: true, staged: true }),
      buildProfile: async () => MOCK_PROFILE,
      generateSuggestions: async () => {
        throw new Error('provider unavailable');
      },
      readMessageFile: async (filePath) => readFileSync(filePath, 'utf-8'),
      writeMessageFile: async (filePath, content) => writeFileSync(filePath, content, 'utf-8'),
      writePendingEntryFile: async (content) => {
        pendingEntry = content;
      },
      removePendingEntryFile: async () => {
        pendingEntry = '';
      },
      warn: () => {},
    };

    await runPrepareCommitMsgHook({ messageFile, source: 'template' }, deps);

    assert.equal(pendingEntry, '');
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('runPostCommitHook appends the committed message to history and clears the pending entry', async () => {
  let removed = false;
  const entries = [];

  await runPostCommitHook({
    checkGitRepo: () => {},
    readLatestCommitMessage: () => 'feat: persist hook-driven commits',
    readPendingEntryFile: async () =>
      JSON.stringify({
        timestamp: '2026-06-01T00:00:00.000Z',
        diff: 'diff --git a/file b/file\n+hello',
        model: 'mock-model',
        provider: 'mock',
      }),
    appendHistoryEntry: async (entry) => {
      entries.push(entry);
    },
    removePendingEntryFile: async () => {
      removed = true;
    },
    warn: () => {},
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].message, 'feat: persist hook-driven commits');
  assert.equal(entries[0].model, 'mock-model');
  assert.equal(entries[0].provider, 'mock');
  assert.equal(entries[0].diff, 'diff --git a/file b/file\n+hello');
  assert.equal(removed, true);
});

test('runPostCommitHook clears malformed pending entries', async () => {
  let removed = false;
  let appended = false;

  await runPostCommitHook({
    checkGitRepo: () => {},
    readLatestCommitMessage: () => 'feat: should not append',
    readPendingEntryFile: async () => '{not-json',
    appendHistoryEntry: async () => {
      appended = true;
    },
    removePendingEntryFile: async () => {
      removed = true;
    },
    warn: () => {},
  });

  assert.equal(appended, false);
  assert.equal(removed, true);
});

test('runPostCommitHook clears pending entry when history append fails', async () => {
  let removed = false;

  await runPostCommitHook({
    checkGitRepo: () => {},
    readLatestCommitMessage: () => 'feat: should still clear pending on error',
    readPendingEntryFile: async () =>
      JSON.stringify({
        timestamp: '2026-06-01T00:00:00.000Z',
        diff: 'diff --git a/file b/file\n+hello',
        model: 'mock-model',
        provider: 'mock',
      }),
    appendHistoryEntry: async () => {
      throw new Error('disk full');
    },
    removePendingEntryFile: async () => {
      removed = true;
    },
    warn: () => {},
  });

  assert.equal(removed, true);
});
