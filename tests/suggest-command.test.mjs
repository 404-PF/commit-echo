import assert from 'node:assert/strict';
import test from 'node:test';

import { stagedDiffMatches } from '../dist/commands/suggest.js';

const stagedDiff = { diff: 'diff --git a/file b/file', hasChanges: true, staged: true };

test('stagedDiffMatches accepts the unchanged staged diff', () => {
  assert.equal(stagedDiffMatches(stagedDiff, { ...stagedDiff }), true);
});

test('stagedDiffMatches rejects an empty or unstaged current diff', () => {
  assert.equal(stagedDiffMatches(stagedDiff, { diff: '', hasChanges: false, staged: true }), false);
  assert.equal(stagedDiffMatches(stagedDiff, { ...stagedDiff, staged: false }), false);
});

test('stagedDiffMatches rejects a changed staged diff', () => {
  assert.equal(stagedDiffMatches(stagedDiff, { ...stagedDiff, diff: 'different diff' }), false);
});
