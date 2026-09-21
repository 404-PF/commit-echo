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

test('verifyStagedDiff rejects a matching diff that is not staged', () => {
  assert.equal(
    verifyStagedDiff(analyzedDiff, {
      diff: analyzedDiff,
      hasChanges: true,
      staged: false,
    }),
    undefined,
  );
});

test('verifyStagedDiff ignores file-section ordering for mixed tracked and untracked diffs', () => {
  const trackedDiff = 'diff --git a/tracked.txt b/tracked.txt\n+changed\n';
  const untrackedDiff = 'diff --git a/untracked.txt b/untracked.txt\n+new file\n';

  assert.equal(
    verifyStagedDiff(`${trackedDiff}${untrackedDiff}`, {
      diff: `${untrackedDiff}${trackedDiff}`,
      hasChanges: true,
      staged: true,
    }),
    `${untrackedDiff}${trackedDiff}`,
  );
});

test('verifyStagedDiff does not ignore trailing spaces inside a non-final file section', () => {
  const analyzedDiff =
    'diff --git a/tracked.txt b/tracked.txt\n+changed\n' +
    'diff --git a/untracked.txt b/untracked.txt\n+new file';
  const currentDiff =
    'diff --git a/tracked.txt b/tracked.txt\n+changed \n' +
    'diff --git a/untracked.txt b/untracked.txt\n+new file';

  assert.equal(
    verifyStagedDiff(analyzedDiff, {
      diff: currentDiff,
      hasChanges: true,
      staged: true,
    }),
    undefined,
  );
});

test('verifyStagedDiff preserves standalone carriage returns', () => {
  const analyzedDiff = 'diff --git a/tracked.txt b/tracked.txt\n+changed\r\n+next';
  const currentDiff = 'diff --git a/tracked.txt b/tracked.txt\r\n+changed\r+next';

  assert.equal(
    verifyStagedDiff(analyzedDiff, {
      diff: currentDiff,
      hasChanges: true,
      staged: true,
    }),
    undefined,
  );
});

test('verifyStagedDiff rejects diffs that differ only by CRLF line endings', () => {
  const analyzedDiff = 'diff --git a/tracked.txt b/tracked.txt\n+changed\n+next\n';
  const currentDiff = 'diff --git a/tracked.txt b/tracked.txt\r\n+changed\r\n+next\r\n';

  assert.equal(
    verifyStagedDiff(analyzedDiff, {
      diff: currentDiff,
      hasChanges: true,
      staged: true,
    }),
    undefined,
  );
});

test('verifyStagedDiff preserves line endings at non-final file section boundaries', () => {
  const analyzedDiff =
    'diff --git a/tracked.txt b/tracked.txt\n+changed\n' +
    'diff --git a/untracked.txt b/untracked.txt\n+new file\n';
  const currentDiff =
    'diff --git a/tracked.txt b/tracked.txt\n+changed\r\n' +
    'diff --git a/untracked.txt b/untracked.txt\n+new file\n';

  assert.equal(
    verifyStagedDiff(analyzedDiff, {
      diff: currentDiff,
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
