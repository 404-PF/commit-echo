import assert from 'node:assert/strict';
import test from 'node:test';

import { buildUserPrompt } from '../dist/llm/prompt.js';

test('buildUserPrompt includes the provided diff content', () => {
  const diff = 'diff --git a/src/a.ts b/src/a.ts\nindex abc..def 100644';
  const prompt = buildUserPrompt(diff);

  assert.ok(prompt.includes(diff));
});

test('buildUserPrompt wraps diff in a code block with diff syntax', () => {
  const prompt = buildUserPrompt('some diff content');

  assert.ok(prompt.includes('```diff'));
  assert.ok(prompt.includes('```'));
  // The diff content should appear between code fences
  const codeBlockStart = prompt.indexOf('```diff');
  const codeBlockEnd = prompt.indexOf('```', codeBlockStart + 7);
  assert.ok(codeBlockStart < prompt.indexOf('some diff content'));
  assert.ok(prompt.indexOf('some diff content') < codeBlockEnd);
});

test('buildUserPrompt includes instruction to generate 3 suggestions', () => {
  const prompt = buildUserPrompt('diff');

  assert.ok(prompt.includes('Generate 3 commit message suggestions'));
});

test('buildUserPrompt includes instruction to return numbered list', () => {
  const prompt = buildUserPrompt('diff');

  assert.ok(prompt.includes('Return exactly 3 options as a numbered list'));
});

test('buildUserPrompt handles empty diff string', () => {
  const prompt = buildUserPrompt('');

  assert.ok(prompt.includes('```diff\n\n```'));
  assert.ok(prompt.includes('Generate 3 commit message suggestions'));
});

test('buildUserPrompt preserves multi-line diffs', () => {
  const diff = 'diff --git a/x.ts b/x.ts\n@@ -1,3 +1,4 @@\n line1\n+added\n line2\n line3';
  const prompt = buildUserPrompt(diff);

  assert.ok(prompt.includes(diff));
  // Multi-line diff should be fully preserved
  assert.ok(prompt.includes('line1'));
  assert.ok(prompt.includes('+added'));
  assert.ok(prompt.includes('line3'));
});
