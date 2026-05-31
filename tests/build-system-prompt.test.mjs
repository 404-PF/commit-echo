import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSystemPrompt } from '../dist/llm/prompt.js';

test('includes fallback guidance when commit history is empty', () => {
  const prompt = buildSystemPrompt({
    avgLength: 0,
    commonPrefixes: [],
    prefixRates: {},
    imperativeRate: 0,
    sentenceCaseRate: 0,
    usesScopeRate: 0,
    usesBodyRate: 0,
    totalCommits: 0,
  });

  assert.ok(
    prompt.includes('No previous commit history available. Use a clear, concise style.')
  );
});
