import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

test('CLI help output includes the command name or usage text', async () => {
  const { stdout } = await execFileAsync(process.execPath, ['dist/index.js', '--help']);

  assert.match(stdout, /commit-echo|Usage:/);
});

test('root help output includes verbose option', async () => {
  const { stdout } = await execFileAsync(process.execPath, ['dist/index.js', '--help']);

  assert.match(stdout, /-v, --verbose/);
});

test('suggest help output includes verbose option', async () => {
  const { stdout } = await execFileAsync(process.execPath, ['dist/index.js', 'suggest', '--help']);

  assert.match(stdout, /-v, --verbose/);
});
