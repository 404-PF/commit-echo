import assert from 'node:assert/strict';
import { dirname } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

export function writeInvalidConfig(configPath) {
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, '{not valid json', 'utf-8');
}

export function assertFriendlyCommandError(error, expectedMessage) {
  const output = error.stdout + error.stderr;

  assert.equal(error.code, 1);
  assert.match(output, expectedMessage);
  assert.doesNotMatch(output, /^\s*at\s+/m);
  return true;
}

export function assertJsonCommandError(error, expectedMessage) {
  assert.equal(error.code, 1);
  assert.equal(error.stderr, '');

  const data = JSON.parse(error.stdout);
  assert.match(data.error, expectedMessage);
  return true;
}
