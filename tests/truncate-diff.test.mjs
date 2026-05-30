import assert from 'node:assert/strict';
import test from 'node:test';

import { truncateDiff } from '../dist/llm/prompt.js';

const FILE_A = `diff --git a/src/a.ts b/src/a.ts
index abc..def 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 line1
+added
 line2
 line3`;

const FILE_B = `diff --git a/src/b.ts b/src/b.ts
index 123..456 100644
--- a/src/b.ts
+++ b/src/b.ts
@@ -10,7 +10,7 @@
 context
-context
+changed`;

test('passes through diff when under the limit', () => {
  const { diff, info } = truncateDiff(FILE_A, 500);
  assert.equal(diff, FILE_A);
  assert.equal(info.wasTruncated, false);
  assert.equal(info.truncatedSize, FILE_A.length);
});

test('passes through diff when exactly at the limit', () => {
  const { diff, info } = truncateDiff(FILE_A, FILE_A.length);
  assert.equal(diff, FILE_A);
  assert.equal(info.wasTruncated, false);
});

test('passes through empty diff unchanged', () => {
  const { diff, info } = truncateDiff('', 100);
  assert.equal(diff, '');
  assert.equal(info.wasTruncated, false);
});

test('truncates single file that exceeds the limit', () => {
  const tinyLimit = 80;
  const { diff, info } = truncateDiff(FILE_A, tinyLimit);

  assert.equal(info.wasTruncated, true);
  assert.equal(info.filesTruncated, 1);
  assert.ok(info.originalSize > info.truncatedSize);

  // Header lines that fit within the limit should be preserved
  assert.ok(diff.includes('diff --git a/src/a.ts b/src/a.ts'));
  assert.ok(diff.includes('index abc..def 100644'));

  // Truncation marker should be present
  assert.ok(diff.includes('[...truncated 1 file...]'));

  // Body content should be removed (partial truncation)
  assert.ok(!diff.includes('+added'));
});

test('truncates multiple files keeping first fully and partially keeping second', () => {
  const twoFileDiff = FILE_A + '\n' + FILE_B;
  // Set limit to fit FILE_A but not both
  const limit = FILE_A.length + 60;
  const { diff, info } = truncateDiff(twoFileDiff, limit);

  assert.equal(info.wasTruncated, true);
  assert.equal(info.filesTruncated, 1);

  // First file should be fully preserved
  assert.ok(diff.includes('diff --git a/src/a.ts b/src/a.ts'));
  assert.ok(diff.includes('+added'));

  // Second file header should be present if space allows
  assert.ok(diff.includes('diff --git a/src/b.ts b/src/b.ts'));
  assert.ok(diff.includes('[...truncated 1 file...]'));
});

test('truncates all files when limit is extremely small', () => {
  const twoFileDiff = FILE_A + '\n' + FILE_B;
  const { diff, info } = truncateDiff(twoFileDiff, 10);

  assert.equal(info.wasTruncated, true);
  assert.equal(info.filesTruncated, 2);

  // Only the truncation marker should remain (no headers fit)
  assert.ok(!diff.includes('diff --git'));
});

test('reports correct original and truncated sizes', () => {
  const limit = 100;
  const { info } = truncateDiff(FILE_A, limit);

  assert.equal(info.originalSize, FILE_A.length);
  assert.ok(info.truncatedSize <= info.originalSize);
  assert.ok(info.truncatedSize > 0);
});

test('returns wasTruncated:false with zero filesTruncated when under limit', () => {
  const { info } = truncateDiff(FILE_A, FILE_A.length + 1000);
  assert.equal(info.wasTruncated, false);
  assert.equal(info.filesTruncated, 0);
});
