import assert from 'node:assert/strict';
import test from 'node:test';

import { getProviderInfo, getProviderNames } from '../dist/providers/registry.js';

test('getProviderInfo returns built-in OpenAI metadata', () => {
  assert.strictEqual(getProviderInfo('openai')?.key, 'openai');
  assert.strictEqual(getProviderInfo('openai')?.baseUrl, 'https://api.openai.com/v1');
});

test('getProviderInfo returns undefined for unknown providers', () => {
  assert.strictEqual(getProviderInfo('nonexistent'), undefined);
});

test('getProviderNames includes OpenAI', () => {
  assert.ok(getProviderNames().includes('OpenAI'));
});
