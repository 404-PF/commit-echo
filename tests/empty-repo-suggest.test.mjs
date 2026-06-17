import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

function createTempDir(prefix) {
  return realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
}

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: 'pipe',
  });
}

test('suggest exits early with a clear message in a git repo with no commits', () => {
  const repoDir = createTempDir('commit-echo-empty-repo-');
  const configDir = createTempDir('commit-echo-empty-config-');

  try {
    git(['init'], repoDir);

    const result = spawnSync(
      process.execPath,
      [join(process.cwd(), 'dist', 'index.js'), '--no-color', 'suggest', '--dry-run'],
      {
        cwd: repoDir,
        encoding: 'utf-8',
        env: {
          ...process.env,
          APPDATA: configDir,
          CI: '1',
          NO_COLOR: '1',
        },
      },
    );

    const output = `${result.stdout}\n${result.stderr}`;

    assert.equal(result.status, 0, output);
    assert.match(output, /repository has no commits yet/i);
    assert.match(output, /needs at least one commit/i);
    assert.doesNotMatch(output, /No configuration found/i);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(configDir, { recursive: true, force: true });
  }
});
