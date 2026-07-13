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

test('getProviderInfo returns built-in OpenRouter metadata', () => {
  assert.deepStrictEqual(getProviderInfo('openrouter'), {
    key: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    website: 'https://openrouter.ai',
    docsUrl: 'https://openrouter.ai/docs',
    needsApiKey: true,
  });
});
