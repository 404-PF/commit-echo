import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeBaseUrl } from '../dist/commands/init.js';

test('handles single trailing slash', () => {
  assert.equal(normalizeBaseUrl('https://api.example.com/v1/'), 'https://api.example.com/v1');
});

test('trims multiple trailing slashes from custom base URLs', () => {
  assert.equal(normalizeBaseUrl('https://api.example.com/v1///'), 'https://api.example.com/v1');
});

test('preserves custom base URLs without trailing slashes', () => {
  assert.equal(normalizeBaseUrl('https://api.example.com/v1'), 'https://api.example.com/v1');
});
