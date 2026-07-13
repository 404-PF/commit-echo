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
    assert.equal(typeof provider.key, 'string');
    assert.notEqual(provider.key, '');
    assert.equal(typeof provider.name, 'string');
    assert.notEqual(provider.name, '');
    assert.equal(typeof provider.needsApiKey, 'boolean');

    if (provider.key === 'example') {
      assert.equal(provider.baseUrl, '');
      assert.equal(provider.apiKeyEnv, '');
      assert.equal(provider.website, '');
      assert.equal(provider.docsUrl, '');
      assert.equal(provider.needsApiKey, false);
      continue;
    }

    assert.match(provider.baseUrl, /^https?:\/\//);
    assert.match(provider.website, /^https?:\/\//);
    assert.match(provider.docsUrl, /^https?:\/\//);

    if (provider.needsApiKey) {
      assert.match(provider.apiKeyEnv, /^[A-Z][A-Z0-9_]*_API_KEY$/);
    } else {
      assert.equal(typeof provider.apiKeyEnv, 'string');
    }
  }
});
