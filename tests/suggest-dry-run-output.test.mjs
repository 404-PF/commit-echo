import assert from 'node:assert/strict';
import test from 'node:test';

import { formatDryRunOutput } from '../dist/commands/suggest.js';
import { resolveSystemPrompt, resolveUserPrompt, truncateDiff } from '../dist/llm/prompt.js';

const EMPTY_PROFILE = {
  avgLength: 0,
  commonPrefixes: [],
  prefixRates: {},
  imperativeRate: 0,
  sentenceCaseRate: 0,
  usesScopeRate: 0,
  usesBodyRate: 0,
  totalCommits: 0,
};

test('formats dry-run output with the LLM inputs and truncation info', () => {
  const output = formatDryRunOutput(
    'diff --git a/file.ts b/file.ts',
    'Analyzed 2 commit(s)',
    'system prompt text',
    'user prompt text',
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

test('dry-run prompt construction matches template substitution path', () => {
  const vars = {
    diff: 'trimmed diff',
    profile: 'profile summary',
    branch: 'feature/dry-run',
  };
  const config = {
    provider: 'openai',
    model: 'gpt-4.1',
    historySize: 50,
    maxDiffSize: 4000,
    systemPromptTemplate: 'system {{branch}} :: {{profile}}',
    userPromptTemplate: 'user {{branch}} :: {{diff}}',
  };

  const output = formatDryRunOutput(
    vars.diff,
    vars.profile,
    resolveSystemPrompt(EMPTY_PROFILE, vars, config),
    resolveUserPrompt(vars, config),
  );

  assert.match(output, /system feature\/dry-run :: profile summary/);
  assert.match(output, /user feature\/dry-run :: trimmed diff/);
});

test('dry-run truncation output matches the real prompt payload', () => {
  const largeDiff = [
    'diff --git a/src/a.ts b/src/a.ts',
    'index abc..def 100644',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1,1 +1,20 @@',
    ...Array.from({ length: 40 }, (_, i) => `+line ${i}`),
  ].join('\n');

  const { diff, info } = truncateDiff(largeDiff, 120);
  const output = formatDryRunOutput(
    diff,
    'profile summary',
    'system prompt text',
    'user prompt text',
    info.wasTruncated ? info : undefined,
  );

  assert.match(output, /\[\.\.\.truncated 1 file\.\.\.\]/);
  assert.match(
    output,
    new RegExp(`${info.originalSize} -> ${info.truncatedSize} chars across ${info.filesTruncated} file\\(s\\)`),
  );
  assert.doesNotMatch(output, /sent in full/);
});
