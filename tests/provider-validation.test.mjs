import assert from 'node:assert/strict';
import test from 'node:test';

import { complete, fetchModels } from '../dist/providers/index.js';

const chatParams = {
  model: 'test-model',
  messages: [{ role: 'user', content: 'hello' }],
  apiKey: 'test-key',
};

test('complete rejects unknown provider keys with valid options', async () => {
  await assert.rejects(
    complete('nonexistent-provider', undefined, chatParams),
    /Unknown provider: 'nonexistent-provider'\. Valid providers: .*openai.*anthropic.*__custom__/
  );
});

test('fetchModels rejects unknown provider keys with valid options', async () => {
  await assert.rejects(
    fetchModels('nonexistent-provider', undefined, 'test-key'),
    /Unknown provider: 'nonexistent-provider'\. Valid providers: .*openai.*anthropic.*__custom__/
  );
});

test('custom provider requires a base URL', async () => {
  await assert.rejects(
    complete('__custom__', undefined, chatParams),
    /Custom provider requires a base URL/
  );
});
