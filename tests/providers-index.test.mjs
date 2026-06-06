import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertStreamingSupported,
  completeStream,
  createProvider,
  fetchModels,
} from '../dist/providers/index.js';

test('createProvider returns the Anthropic adapter shape', () => {
  const provider = createProvider('anthropic');

  assert.equal(typeof provider.complete, 'function');
  assert.equal(typeof provider.fetchModels, 'function');
});

test('fetchModels returns Anthropic model ids', async () => {
  const models = await fetchModels('anthropic', undefined, '');

  assert.ok(models.length > 0);
  assert.ok(models.includes('claude-sonnet-4'));
});

test('assertStreamingSupported rejects providers without streaming', () => {
  assert.throws(
    () => assertStreamingSupported('cohere'),
    /Streaming is not supported for the 'cohere' provider/,
  );
});

test('assertStreamingSupported accepts streaming providers', () => {
  assert.doesNotThrow(() => assertStreamingSupported('anthropic'));
  assert.doesNotThrow(() => assertStreamingSupported('openai'));
});

test('completeStream rejects Cohere before making a request', async () => {
  await assert.rejects(
    async () => {
      for await (const _chunk of completeStream('cohere', undefined, {
        model: 'command',
        messages: [{ role: 'user', content: 'test' }],
        apiKey: 'test-key',
      })) {
        // no-op
      }
    },
    /Streaming is not supported for the 'cohere' provider/,
  );
});
