import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeBaseUrl, resolveBaseUrl } from '../dist/commands/init.js';

test('uses the selected built-in provider URL instead of a stale custom URL', () => {
  assert.equal(resolveBaseUrl('openai', 'https://custom.example.com/v1'), 'https://api.openai.com/v1');
});

test('preserves the existing base URL for the custom provider', () => {
  assert.equal(resolveBaseUrl('__custom__', 'https://custom.example.com/v1'), 'https://custom.example.com/v1');
});

test('trims single trailing slash from custom base URL', () => {
  assert.equal(normalizeBaseUrl('https://api.example.com/v1/'), 'https://api.example.com/v1');
});

test('trims multiple trailing slashes from custom base URLs', () => {
  assert.equal(normalizeBaseUrl('https://api.example.com/v1///'), 'https://api.example.com/v1');
});

test('preserves custom base URLs without trailing slashes', () => {
  assert.equal(normalizeBaseUrl('https://api.example.com/v1'), 'https://api.example.com/v1');
});

test('preserves URL with path segments', () => {
  assert.equal(normalizeBaseUrl('https://api.example.com/api/v1/'), 'https://api.example.com/api/v1');
});

test('handles root URL with trailing slash', () => {
  assert.equal(normalizeBaseUrl('https://api.example.com/'), 'https://api.example.com');
});
