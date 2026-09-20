import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyStagedDiff } from '../dist/commands/suggest.js';

const analyzedDiff = 'diff --git a/README.md b/README.md\n+updated';

test('verifyStagedDiff rejects an empty current index', () => {
  assert.equal(
    verifyStagedDiff(analyzedDiff, {
      diff: '',
      hasChanges: false,
      staged: true,
    }),
    undefined,
  );
});

test('verifyStagedDiff rejects a staged diff that changed after analysis', () => {
  assert.equal(
    verifyStagedDiff(analyzedDiff, {
      diff: 'diff --git a/README.md b/README.md\n+replacement',
      hasChanges: true,
      staged: true,
    }),
    undefined,
  );
});

test('verifyStagedDiff returns the current staged diff when it still matches', () => {
  const currentDiff = {
    diff: analyzedDiff,
    hasChanges: true,
    staged: true,
  };

  assert.equal(verifyStagedDiff(analyzedDiff, currentDiff), currentDiff.diff);
});
