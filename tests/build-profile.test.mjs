import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProfile } from '../dist/history/store.js';

const history = [
  { message: 'fix: bug' },
  { message: 'feat: feature' },
];

test('buildProfile returns correct profile', async () => {
  const history = [
    { message: 'fix: bug' },
    { message: 'feat: feature' },
  ];
  const profile = await buildProfile(history.length);
  assert.strictEqual(profile.avgLength, 15);
  assert.strictEqual(profile.prefixRates.fix, 0.5);
  assert.strictEqual(profile.imperativeRate, 1);
  assert.strictEqual(profile.sentenceCaseRate, 0);
  assert.strictEqual(profile.scopeUsage, 0);
  assert.strictEqual(profile.bodyUsage, 1);
  assert.strictEqual(profile.totalCommits, history.length);
});