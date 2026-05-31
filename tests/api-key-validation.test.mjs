import assert from 'node:assert/strict';
import test from 'node:test';

import { assertApiKeyAvailable } from '../dist/llm/client.js';

const openAIConfig = {
  provider: 'openai',
  model: 'gpt-4.1',
  historySize: 50,
  maxDiffSize: 4000,
};

test('assertApiKeyAvailable raises a clear error when a required key is missing', () => {
  const original = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  try {
    assert.throws(
      () => assertApiKeyAvailable(openAIConfig),
      /No API key found\. Run commit-echo init to set one, or export OPENAI_API_KEY\./
    );
  } finally {
    if (original === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = original;
    }
  }
});

test('assertApiKeyAvailable returns the environment key when present', () => {
  const original = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'sk-test';

  try {
    assert.equal(assertApiKeyAvailable(openAIConfig), 'sk-test');
  } finally {
    if (original === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = original;
    }
  }
});

test('assertApiKeyAvailable returns the config key when present', () => {
  const original = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'sk-env';

  try {
    assert.equal(assertApiKeyAvailable({ ...openAIConfig, apiKey: 'sk-configured' }), 'sk-configured');
  } finally {
    if (original === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = original;
    }
  }
});

test('assertApiKeyAvailable does not throw for providers that do not need an API key', () => {
  const config = {
    provider: 'ollama',
    model: 'llama3',
    historySize: 50,
    maxDiffSize: 4000,
  };

  assert.doesNotThrow(() => assertApiKeyAvailable(config));
  assert.equal(assertApiKeyAvailable(config), '');
});
