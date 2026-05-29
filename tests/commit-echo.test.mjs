import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

if (process.platform === 'win32') {
  test.skip('commit writes message to temp file and invokes git -F (mocked) - skipped on Windows', () => {});
} else {
  test('commit writes message to temp file and invokes git -F (mocked)', () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'fakegit-'));
  const isWin = process.platform === 'win32';
  const gitPath = isWin ? join(tmpRoot, 'git.cmd') : join(tmpRoot, 'git');

  if (isWin) {
    // Batch script: %1=commit %2=-F %3=<file>
    writeFileSync(gitPath, '@echo off\r\ntype %3\r\n', 'utf-8');
  } else {
    writeFileSync(
      gitPath,
      '#!/usr/bin/env node\n' +
        'const fs = require("fs");\n' +
        'const p = process.argv[4];\n' +
        'const c = fs.readFileSync(p, "utf8");\n' +
        'console.log(c);\n',
      'utf-8'
    );
    chmodSync(gitPath, 0o755);
  }

  const origPath = process.env.PATH ?? '';
  process.env.PATH = `${tmpRoot}${delimiter}${origPath}`;

  try {
    const title = 'feat: add temp-file test';
    const body = 'line-one\nline-two';

    // runner imports the compiled commit function and calls it so the child
    // process inherits the modified PATH reliably on Windows
    const runnerPath = join(tmpRoot, 'runner.mjs');
    const diffAbs = join(process.cwd(), 'dist', 'git', 'diff.js');
    const diffUrl = pathToFileURL(diffAbs).href;
    const runnerSrc = `(async ()=>{ const { commit } = await import('${diffUrl}'); try{ const out = commit(${JSON.stringify(
      title
    )}, ${JSON.stringify(body)}); console.log(out); process.exit(0);}catch(e){ console.error(e instanceof Error?e.message:String(e)); process.exit(2);} })();`;
    writeFileSync(runnerPath, runnerSrc, 'utf-8');
    const res = spawnSync(process.execPath, [runnerPath], { env: { ...process.env, PATH: `${tmpRoot}${delimiter}${origPath}` }, encoding: 'utf-8' });
    if (res.error) throw res.error;
    assert.strictEqual(res.status, 0, `child exited non-zero: ${res.stderr || res.stdout}`);
    assert.ok(res.stdout.includes(title), 'stdout should include title');
    assert.ok(res.stdout.includes('line-one'), 'stdout should include body content');
  } finally {
    process.env.PATH = origPath;
    rmSync(tmpRoot, { recursive: true, force: true });
  }
  });
}

test('commit throws when git exits non-zero', () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'fakegit-'));
  const isWin = process.platform === 'win32';
  const gitPath = isWin ? join(tmpRoot, 'git.cmd') : join(tmpRoot, 'git');

  if (isWin) {
    writeFileSync(gitPath, '@echo off\r\necho fail 1>&2\r\nexit /b 1\r\n', 'utf-8');
  } else {
    writeFileSync(
      gitPath,
      '#!/usr/bin/env node\n' +
        'console.error("fail");\n' +
        'process.exit(1);\n',
      'utf-8'
    );
    chmodSync(gitPath, 0o755);
  }

  const origPath = process.env.PATH ?? '';
  process.env.PATH = `${tmpRoot}${delimiter}${origPath}`;

  try {
    const runnerPath = join(tmpRoot, 'runner.mjs');
    const diffAbs = join(process.cwd(), 'dist', 'git', 'diff.js');
    const diffUrl = pathToFileURL(diffAbs).href;
    const runnerSrc = `(async ()=>{ const { commit } = await import('${diffUrl}'); try{ commit('msg','body'); console.log('OK'); process.exit(0);}catch(e){ console.error(e instanceof Error?e.message:String(e)); process.exit(2);} })();`;
    writeFileSync(runnerPath, runnerSrc, 'utf-8');
    const res = spawnSync(process.execPath, [runnerPath], { env: { ...process.env, PATH: `${tmpRoot}${delimiter}${origPath}` }, encoding: 'utf-8' });
    // child should exit non-zero
    assert.notStrictEqual(res.status, 0, 'child should exit with non-zero status');
  } finally {
    process.env.PATH = origPath;
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});
