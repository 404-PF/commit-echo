import assert from 'node:assert/strict';
import test from 'node:test';

import { promptModel } from '../dist/commands/init.js';

const originalFetch = globalThis.fetch;

test('promptModel falls back to manual entry when model discovery returns no models', async (t) => {
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url) => {
    assert.equal(url, 'https://openai.example.com/v1/models');
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  let manualPrompted = false;
  let selectedOptions;
  const spinnerMessages = [];

  const result = await promptModel(
    {
      providerKey: '__custom__',
      baseUrl: 'https://openai.example.com/v1',
      apiKeyEnv: 'CUSTOM_API_KEY',
      needsApiKey: true,
    },
    'test-key',
    null,
    {
      spinner: () => ({
        start: (message) => spinnerMessages.push(message),
        stop: (message) => spinnerMessages.push(message),
      }),
      text: async (options) => {
        assert.equal(options.message, 'Enter model name manually:');
        assert.equal(options.validate?.('   '), 'Model name is required');
        assert.equal(options.validate?.(' custom-model '), undefined);
        manualPrompted = true;
        return ' custom-model ';
      },
      select: async (options) => {
        assert.equal(options.message, 'Select a model:');
        selectedOptions = options.options;
        return 'custom-model';
      },
    },
  );

  assert.equal(result, 'custom-model');
  assert.equal(manualPrompted, true);
  assert.deepEqual(selectedOptions, [{ value: 'custom-model', label: 'custom-model' }]);
  assert.deepEqual(
    spinnerMessages.map((message) => message.replace(/\u001b\[[0-9;]*m/g, '')),
    ['Fetching available models...', 'No models found automatically.'],
  );
});
