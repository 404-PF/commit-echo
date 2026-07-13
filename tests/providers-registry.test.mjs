import assert from 'node:assert/strict';
import test from 'node:test';

import { BUILTIN_PROVIDERS, getProviderInfo, getProviderNames } from '../dist/providers/registry.js';

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

test('all built-in providers expose required metadata', () => {
  assert.ok(BUILTIN_PROVIDERS.length > 0);

  for (const provider of BUILTIN_PROVIDERS) {
    assert.strictEqual(typeof provider.key, 'string');
    assert.notStrictEqual(provider.key, '');
    assert.strictEqual(typeof provider.name, 'string');
    assert.notStrictEqual(provider.name, '');
    assert.strictEqual(typeof provider.needsApiKey, 'boolean');

    if (provider.key === 'example') {
      assert.strictEqual(provider.baseUrl, '');
      assert.strictEqual(provider.apiKeyEnv, '');
      assert.strictEqual(provider.website, '');
      assert.strictEqual(provider.docsUrl, '');
      assert.strictEqual(provider.needsApiKey, false);
      continue;
    }

    assert.match(provider.baseUrl, /^https?:\/\//);
    assert.match(provider.website, /^https?:\/\//);
    assert.match(provider.docsUrl, /^https?:\/\//);

    if (provider.needsApiKey) {
      assert.match(provider.apiKeyEnv, /^[A-Z][A-Z0-9_]*_API_KEY$/);
    } else {
      assert.strictEqual(typeof provider.apiKeyEnv, 'string');
    }
  }
});
