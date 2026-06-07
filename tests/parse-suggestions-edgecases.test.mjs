import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSuggestions } from '../dist/llm/prompt.js';

// ── Numbered list (baseline) ────────────────────────────────────────────────

test('parses standard numbered list with period delimiter', () => {
  const input = `1. feat: add user auth
2. fix: resolve login redirect
3. refactor: extract auth middleware`;

  const result = parseSuggestions(input);
  assert.equal(result.length, 3);
  assert.equal(result[0].message, 'feat: add user auth');
  assert.equal(result[1].message, 'fix: resolve login redirect');
  assert.equal(result[2].message, 'refactor: extract auth middleware');
});

test('parses numbered list with closing-paren delimiter', () => {
  const input = `1) feat: add user auth
2) fix: resolve login redirect
3) refactor: extract auth middleware`;

  const result = parseSuggestions(input);
  assert.equal(result.length, 3);
  assert.equal(result[0].message, 'feat: add user auth');
  assert.equal(result[1].message, 'fix: resolve login redirect');
  assert.equal(result[2].message, 'refactor: extract auth middleware');
});

// ── Bullet list (dash) ──────────────────────────────────────────────────────

test('parses dash-bulleted list', () => {
  const input = `- feat: add user auth
- fix: resolve login redirect
- refactor: extract auth middleware`;

  const result = parseSuggestions(input);
  assert.equal(result.length, 3);
  assert.equal(result[0].message, 'feat: add user auth');
  assert.equal(result[1].message, 'fix: resolve login redirect');
  assert.equal(result[2].message, 'refactor: extract auth middleware');
});

test('parses asterisk-bulleted list', () => {
  const input = `* feat: add user auth
* fix: resolve login redirect
* refactor: extract auth middleware`;

  const result = parseSuggestions(input);
  assert.equal(result.length, 3);
  assert.equal(result[0].message, 'feat: add user auth');
  assert.equal(result[1].message, 'fix: resolve login redirect');
  assert.equal(result[2].message, 'refactor: extract auth middleware');
});

// ── Mixed numbering / formats ────────────────────────────────────────────────

test('parses mixed numbered and bulleted items', () => {
  const input = `1. feat: add user auth
- fix: resolve login redirect
* refactor: extract auth middleware`;

  const result = parseSuggestions(input);
  assert.equal(result.length, 3);
  assert.equal(result[0].message, 'feat: add user auth');
  assert.equal(result[1].message, 'fix: resolve login redirect');
  assert.equal(result[2].message, 'refactor: extract auth middleware');
});

// ── Optional body paragraphs ─────────────────────────────────────────────────

test('attaches body text to a bulleted suggestion', () => {
  const input = `- feat: add caching layer
  Improves response time for repeated queries by storing results in Redis.
- fix: resolve null pointer in parser`;

  const result = parseSuggestions(input);
  assert.equal(result.length, 2);
  assert.equal(result[0].message, 'feat: add caching layer');
  assert.match(result[0].body ?? '', /Improves response time/);
  assert.equal(result[1].body, undefined);
});

test('attaches body text to a numbered suggestion', () => {
  const input = `1. feat: add caching layer
   Stores results in Redis to speed up repeated queries.
2. fix: resolve null pointer`;

  const result = parseSuggestions(input);
  assert.equal(result.length, 2);
  assert.match(result[0].body ?? '', /Stores results in Redis/);
  assert.equal(result[1].body, undefined);
});

// ── Edge cases ───────────────────────────────────────────────────────────────

test('respects the count limit', () => {
  const input = `- option one
- option two
- option three
- option four`;

  const result = parseSuggestions(input, 2);
  assert.equal(result.length, 2);
  assert.equal(result[0].message, 'option one');
  assert.equal(result[1].message, 'option two');
});

test('returns empty array for empty input', () => {
  assert.deepEqual(parseSuggestions(''), []);
});

test('returns empty array for whitespace-only input', () => {
  assert.deepEqual(parseSuggestions('   \n  \n  '), []);
});

test('handles leading/trailing whitespace on bullet lines', () => {
  const input = `  - feat: spaced out suggestion
  * fix: another spaced suggestion`;

  const result = parseSuggestions(input);
  assert.equal(result.length, 2);
  assert.equal(result[0].message, 'feat: spaced out suggestion');
  assert.equal(result[1].message, 'fix: another spaced suggestion');
});

test('treats indented numbered sub-items as body text, not new suggestions', () => {
  // LLMs sometimes put a numbered sub-list inside a suggestion body.
  // Those lines must not be parsed as top-level suggestions.
  const input = `1. feat: export profile
   1. gather commits
   2. write JSON
2. fix: handle empty history`;

  const result = parseSuggestions(input);
  assert.equal(result.length, 2);
  assert.equal(result[0].message, 'feat: export profile');
  assert.match(result[0].body ?? '', /gather commits/);
  assert.equal(result[1].message, 'fix: handle empty history');
});

test('treats indented bullet sub-items as body text, not new suggestions', () => {
  const input = `1. refactor: simplify auth flow
   - Extract session parsing
   - Share redirect handling
2. fix: handle expired tokens
   - Return login redirect
3. test: cover auth retries`;

  const result = parseSuggestions(input);

  assert.deepEqual(result, [
    {
      message: 'refactor: simplify auth flow',
      body: 'Extract session parsing\nShare redirect handling',
    },
    {
      message: 'fix: handle expired tokens',
      body: 'Return login redirect',
    },
    {
      message: 'test: cover auth retries',
      body: undefined,
    },
  ]);
});

test('returns fewer than count if fewer items present', () => {
  const input = `- only one suggestion`;
  const result = parseSuggestions(input, 3);
  assert.equal(result.length, 1);
  assert.equal(result[0].message, 'only one suggestion');
});
