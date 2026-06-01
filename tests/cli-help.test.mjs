import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ansiPattern = /\u001b\[[0-9;]*m/;

const forceColorEnv = {
  ...process.env,
  FORCE_COLOR: '1',
  NO_COLOR: '',
};

test('CLI help output includes the command name or usage text', async () => {
  const { stdout } = await execFileAsync(process.execPath, ['dist/index.js', '--help']);

  assert.match(stdout, /commit-echo|Usage:/);
});

test('--no-color disables colored help output', async () => {
  const { stdout: colored } = await execFileAsync(process.execPath, ['dist/index.js', '--help'], {
    env: forceColorEnv,
  });
  const { stdout: plain } = await execFileAsync(process.execPath, ['dist/index.js', '--no-color', '--help'], {
    env: forceColorEnv,
  });

  assert.match(colored, ansiPattern);
  assert.doesNotMatch(plain, ansiPattern);
});

test('NO_COLOR disables colored help output', async () => {
  const { stdout } = await execFileAsync(process.execPath, ['dist/index.js', '--help'], {
    env: {
      ...forceColorEnv,
      NO_COLOR: '1',
    },
  });

  assert.doesNotMatch(stdout, ansiPattern);
});
