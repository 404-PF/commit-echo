import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProfile } from '../dist/history/store.js';

const history = [
  { message: 'fix: bug' },
  { message: 'feat: feature' },
];

test('buildProfile returns correct profile', async () => {
  const profile = await buildProfile(history);
  assert.ok(profile);
});