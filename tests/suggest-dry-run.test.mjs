import assert from 'node:assert/strict';
import test from 'node:test';

import { formatDryRunOutput } from '../dist/commands/suggest.js';

test('formats dry-run output with the LLM inputs and truncation info', () => {
  const output = formatDryRunOutput(
    'diff --git a/file.ts b/file.ts',
    'Analyzed 2 commit(s)',
    'system prompt text',
    'user prompt text'
  );

  assert.match(output, /no LLM API call will be made/);
  assert.match(output, /Diff:/);
  assert.match(output, /diff --git a\/file\.ts b\/file\.ts/);
  assert.match(output, /Style profile:/);
  assert.match(output, /Analyzed 2 commit\(s\)/);
  assert.match(output, /System prompt:/);
  assert.match(output, /system prompt text/);
  assert.match(output, /User prompt:/);
  assert.match(output, /user prompt text/);
  assert.match(output, /Truncation:/);
  assert.match(output, /sent in full/);
});
