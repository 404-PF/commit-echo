import assert from 'node:assert/strict';
import test from 'node:test';

import { getProviderInfo, getProviderNames } from '../dist/providers/registry.js';

test('getProviderInfo returns built-in OpenAI metadata', () => {
  assert.deepEqual(getProviderInfo('openai')?.key, 'openai');
  assert.deepEqual(getProviderInfo('openai')?.baseUrl, 'https://api.openai.com/v1');
});

test('getProviderNames includes OpenAI', () => {
  assert.ok(getProviderNames().includes('OpenAI'));
});
