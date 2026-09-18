import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

function writeFakeGit(gitPath, unixScript, windowsScript) {
  if (process.platform === 'win32') {
    writeFileSync(gitPath, windowsScript, 'utf-8');
    return;
  }

  writeFileSync(gitPath, unixScript, 'utf-8');
  chmodSync(gitPath, 0o755);
}

function withFakeGit(run) {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'fakegit-'));
  const gitPath = join(tmpRoot, process.platform === 'win32' ? 'git.cmd' : 'git');
  const originalPath = process.env.PATH;
  process.env.PATH = `${tmpRoot}${delimiter}${originalPath ?? ''}`;

  try {
    return run({ tmpRoot, gitPath });
  } finally {
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}

function runCommitChild(tmpRoot, commitSource) {
  const runnerPath = join(tmpRoot, 'runner.mjs');
  const diffUrl = pathToFileURL(join(process.cwd(), 'dist', 'git', 'diff.js')).href;
  const runnerSrc = `(async ()=>{ const { commit } = await import(${JSON.stringify(
    diffUrl,
  )}); try{ ${commitSource} }catch(e){ console.error(e instanceof Error?e.message:String(e)); process.exit(2);} })();`;
  writeFileSync(runnerPath, runnerSrc, 'utf-8');

  const result = spawnSync(process.execPath, [runnerPath], {
    env: { ...process.env },
    encoding: 'utf-8',
  });
  if (result.error) throw result.error;
  return result;
}

if (process.platform === 'win32') {
  test.skip('commit pipes message to git -F - (mocked) - skipped on Windows', () => {});
} else {
  test('commit pipes message to git -F - (mocked)', () => {
    withFakeGit(({ tmpRoot, gitPath }) => {
      writeFakeGit(
        gitPath,
        '#!/usr/bin/env node\n' +
          'const fs = require("fs");\n' +
          'const assert = require("node:assert/strict");\n' +
          'assert.deepEqual(process.argv.slice(2), ["commit", "-F", "-"]);\n' +
          'const c = fs.readFileSync(0, "utf8");\n' +
          'if (!c.includes("feat: add temp-file test") || !c.includes("line-one\\nline-two")) process.exit(3);\n' +
          'console.log("[main abc1234] feat: add temp-file test");\n',
        '@echo off\r\n',
      );

    const title = 'feat: add temp-file test';
    const body = 'line-one\nline-two';

    const res = runCommitChild(
      tmpRoot,
      `const out = commit(${JSON.stringify(title)}, ${JSON.stringify(body)}); console.log(JSON.stringify(out)); process.exit(0);`,
    );
    assert.strictEqual(res.status, 0, `child exited non-zero: ${res.stderr || res.stdout}`);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.hash, 'abc1234');
    assert.equal(parsed.summary, title);
    assert.equal(parsed.output.trim(), `[main abc1234] ${title}`);
    });
  });
}

test('commit throws when git exits non-zero', () => {
  withFakeGit(({ tmpRoot, gitPath }) => {
    writeFakeGit(
      gitPath,
      '#!/usr/bin/env node\n' + 'console.error("fail");\n' + 'process.exit(1);\n',
      '@echo off\r\necho fail 1>&2\r\nexit /b 1\r\n',
    );

    const res = runCommitChild(tmpRoot, "commit('msg','body'); console.log('OK'); process.exit(0);");
    // child should exit non-zero
    assert.notStrictEqual(res.status, 0, 'child should exit with non-zero status');
  });
});
