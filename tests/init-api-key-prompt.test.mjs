import assert from 'node:assert/strict';
import test from 'node:test';

import { buildApiKeyPrompt, getExistingApiKeyForProvider, getStoredApiKeyForProvider } from '../dist/commands/init.js';

test('does not prefill an existing API key in the init prompt', () => {
  const prompt = buildApiKeyPrompt('sk-live-secret', 'OPENAI_API_KEY');

  assert.equal(prompt.placeholder, '•••••••• (already configured)');
  assert.equal(Object.hasOwn(prompt, 'initialValue'), false);
});

test('leaves the API key prompt blank for new configs', () => {
  const prompt = buildApiKeyPrompt('', 'OPENAI_API_KEY');

  assert.equal(prompt.placeholder, '');
  assert.equal(Object.hasOwn(prompt, 'initialValue'), false);
});

test('reuses a trimmed stored API key only for the same provider', () => {
  assert.equal(
    getStoredApiKeyForProvider('openai', 'https://api.openai.com/v1', {
      provider: 'openai',
      apiKey: '  sk-openai  ',
    }),
    'sk-openai',
  );
  assert.equal(
    getStoredApiKeyForProvider('anthropic', 'https://api.anthropic.com/v1', {
      provider: 'openai',
      apiKey: 'sk-openai',
    }),
    undefined,
  );
});

test('reuses a custom API key only for the same normalized endpoint', () => {
  const storedConfig = {
    provider: '__custom__',
    baseUrl: 'https://api.example.com/v1',
    apiKey: '  sk-custom  ',
  };

  assert.equal(
    getStoredApiKeyForProvider('__custom__', 'https://api.example.com/v1/', storedConfig),
    'sk-custom',
  );
  assert.equal(
    getStoredApiKeyForProvider('__custom__', 'https://other.example.com/v1', storedConfig),
    undefined,
  );
});

test('ignores a non-string stored API key for the selected provider', () => {
  assert.equal(
    getStoredApiKeyForProvider('openai', 'https://api.openai.com/v1', { provider: 'openai', apiKey: 123 }),
    undefined,
  );
});


test('prefers the trimmed generic API key env override during init reconfiguration', () => {
  const env = {
    COMMIT_ECHO_API_KEY: '  sk-generic  ',
    OPENAI_API_KEY: 'sk-openai',
  };

  assert.equal(
    getExistingApiKeyForProvider(
      'openai',
      'https://api.openai.com/v1',
      { provider: 'openai', apiKey: 'sk-stored' },
      'OPENAI_API_KEY',
      env,
    ),
    'sk-generic',
  );
});

test('falls back to the provider-specific API key env when no generic or matching stored key exists', () => {
  const env = { OPENAI_API_KEY: '  sk-openai  ' };

  assert.equal(
    getExistingApiKeyForProvider(
      'openai',
      'https://api.openai.com/v1',
      { provider: 'anthropic', apiKey: 'sk-anthropic' },
      'OPENAI_API_KEY',
      env,
    ),
    'sk-openai',
  );
  assert.equal(
    getExistingApiKeyForProvider('openai', 'https://api.openai.com/v1', null, 'OPENAI_API_KEY', {}),
    '',
  );
});

test('skips empty API-key candidates after trimming', () => {
  assert.equal(
    getExistingApiKeyForProvider(
      'openai',
      'https://api.openai.com/v1',
      { provider: 'openai', apiKey: '  sk-stored  ' },
      'OPENAI_API_KEY',
      {
        COMMIT_ECHO_API_KEY: '   ',
        OPENAI_API_KEY: 'sk-openai',
      },
    ),
    'sk-stored',
  );

  assert.equal(
    getExistingApiKeyForProvider(
      'openai',
      'https://api.openai.com/v1',
      { provider: 'openai', apiKey: '   ' },
      'OPENAI_API_KEY',
      {
        OPENAI_API_KEY: '  sk-openai  ',
      },
    ),
    'sk-openai',
  );
});
