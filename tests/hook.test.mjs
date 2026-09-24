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

test('buildPrepareCommitMsgHookScript chains backup hook with the captured CLI and PATH fallback', () => {
  const script = buildPrepareCommitMsgHookScript(
    'c:\\tools\\commit-echo\\dist\\index.js',
    'c:\\repo\\.git\\hooks\\prepare-commit-msg.commit-echo.bak',
  );

  assert.match(
    script,
    /if \[ -f 'c:\/repo\/\.git\/hooks\/prepare-commit-msg.commit-echo\.bak' \][\\s\\S]*if \[ -f 'c:\/tools\/commit-echo\/dist\/index\.js' \]; then node 'c:\/tools\/commit-echo\/dist\/index\.js' hook 'prepare-commit-msg' "\$@"; elif command -v commit-echo >\/dev\/null 2>&1; then commit-echo hook 'prepare-commit-msg' "\$@"; fi/,
  );
  assert.match(
    script,
    /if \[ -x 'c:\/repo\/\.git\/hooks\/prepare-commit-msg\.commit-echo\.bak' \]; then 'c:\/repo\/\.git\/hooks\/prepare-commit-msg.commit-echo.bak' "\$@" \|\| exit \$\?; else sh 'c:\/repo\/\.git\/hooks\/prepare-commit-msg.commit-echo.bak' "\$@" \|\| exit \$\?; fi/,
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
    /if \[ -f 'c:\/tools\/commit-echo\/dist\/index\.js' \]; then node 'c:\/tools\/commit-echo\/dist\/index\.js' hook 'post-commit' "\$@"; elif command -v commit-echo >\/dev\/null 2>&1; then commit-echo hook 'post-commit' "\$@"; fi/,
  );
});

test('buildPrepareCommitMsgHookScript safely quotes paths containing shell metacharacters', () => {
  const script = buildPrepareCommitMsgHookScript("/tmp/commit-echo/it's/$(bad)/index.js");

  assert.match(
    script,
    /if \[ -f '\/tmp\/commit-echo\/it'"'"'s\/\$\(bad\)\/index\.js' \]; then node '\/tmp\/commit-echo\/it'"'"'s\/\$\(bad\)\/index\.js' hook 'prepare-commit-msg' "\$@"; elif command -v commit-echo >\/dev\/null 2>&1; then commit-echo hook 'prepare-commit-msg' "\$@";/,
  );
});

test('generated hooks prefer the captured CLI over PATH and fall back when it is missing', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'commit-echo-hook-resolution-test-'));
  const binDir = join(tempDir, 'bin');
  const cliPath = join(tempDir, 'saved-cli.js');
  const hookPath = join(tempDir, 'hook.sh');
  const messagePath = join(tempDir, 'message');
  const resultPath = join(tempDir, 'result');
  const pathCliPath = join(binDir, 'commit-echo');

  mkdirSync(binDir, { recursive: true });
  writeFileSync(
    cliPath,
    "require('node:fs').writeFileSync(process.env.COMMIT_ECHO_RESULT, 'saved');",
    'utf-8',
  );
  writeFileSync(
    pathCliPath,
    '#!/bin/sh\nprintf "%s" path > "$COMMIT_ECHO_RESULT"\n',
    'utf-8',
  );
  chmodSync(pathCliPath, 0o755);
  writeFileSync(
    hookPath,
    `#!/bin/sh
${buildPrepareCommitMsgHookScript(cliPath)}
`,
    'utf-8',
  );
  chmodSync(hookPath, 0o755);

  const env = {
    ...process.env,
    PATH: `${binDir}${process.env.PATH ? `:${process.env.PATH}` : ''}`,
    COMMIT_ECHO_RESULT: resultPath,
  };

  try {
    const firstRun = spawnSync(hookPath, [messagePath], { env, encoding: 'utf-8' });
    assert.equal(firstRun.status, 0, firstRun.stderr);
    assert.equal(readFileSync(resultPath, 'utf-8'), 'saved');

    rmSync(cliPath);
    rmSync(resultPath);
    const fallbackRun = spawnSync(hookPath, [messagePath], { env, encoding: 'utf-8' });
    assert.equal(fallbackRun.status, 0, fallbackRun.stderr);
    assert.equal(readFileSync(resultPath, 'utf-8'), 'path');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
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