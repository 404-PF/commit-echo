import assert from 'node:assert/strict';
import test from 'node:test';

import { getStoredApiKeyForProvider, resolveApiKeySelection } from '../dist/commands/init.js';

const OPENAI_BASE_URL = 'https://api.openai.com/v1';

test('preserves an explicitly stored API key when blank input equals the generic env override', () => {
  // Regression: provenance used to be inferred by comparing the raw config
  // value against COMMIT_ECHO_API_KEY, so a config.json key that happened to
  // equal the env var was treated as env-only and silently deleted on save.
  const storedKey = getStoredApiKeyForProvider('openai', OPENAI_BASE_URL, {
    provider: 'openai',
    apiKey: 'sk-same',
  });

  assert.equal(storedKey, 'sk-same');

  const selection = resolveApiKeySelection('', storedKey, 'sk-same');

  assert.equal(selection.persistKey, 'sk-same');
  assert.equal(selection.effectiveKey, 'sk-same');
});

test('never persists an API key that only came from the environment', () => {
  const selection = resolveApiKeySelection('', undefined, 'sk-env-only');

  assert.equal(selection.persistKey, undefined);
  assert.equal(selection.effectiveKey, 'sk-env-only');
});

test('never persists an API key when neither input nor stored key exists', () => {
  const selection = resolveApiKeySelection('', undefined, '');

  assert.equal(selection.persistKey, undefined);
  assert.equal(selection.effectiveKey, '');
});

test('keeps a stored key effective when the prompt is blank and no env var is set', () => {
  const selection = resolveApiKeySelection('', 'sk-stored', '');

  assert.equal(selection.persistKey, 'sk-stored');
  assert.equal(selection.effectiveKey, 'sk-stored');
});

test('persists the key typed during reconfiguration', () => {
  const selection = resolveApiKeySelection('sk-typed', 'sk-stored', 'sk-env');

  assert.equal(selection.persistKey, 'sk-typed');
  assert.equal(selection.effectiveKey, 'sk-typed');
});

test('prefers a typed key over the environment for the effective key', () => {
  const selection = resolveApiKeySelection('sk-typed', undefined, 'sk-env');

  assert.equal(selection.persistKey, 'sk-typed');
  assert.equal(selection.effectiveKey, 'sk-typed');
});
