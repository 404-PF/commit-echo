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

  assert.ok(prompt.includes('No previous commit history available. Use a clear, concise style.'));
});

test('includes project style guidance when commit history has strong signals', () => {
  const prompt = buildSystemPrompt({
    avgLength: 48,
    commonPrefixes: ['feat', 'fix', 'docs', 'test'],
    prefixRates: { feat: 0.45, fix: 0.25, docs: 0.2, test: 0.1 },
    imperativeRate: 0.75,
    sentenceCaseRate: 0.6,
    usesScopeRate: 0.5,
    usesBodyRate: 0.4,
    totalCommits: 20,
  });

  assert.match(prompt, /Keep the first line around 48 characters/);
  assert.match(prompt, /Use imperative mood/);
  assert.match(prompt, /Start with a capital letter/);
  assert.match(prompt, /commonly uses "feat:" prefix/);
  assert.match(prompt, /Commonly used prefixes in this project: feat, fix, docs/);
  assert.match(prompt, /Include a scope in parentheses when relevant/);
  assert.match(prompt, /Include a body paragraph explaining motivation and context/);
});
