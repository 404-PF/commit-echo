import assert from 'node:assert/strict';
import test from 'node:test';

import { createProvider, fetchModels } from '../dist/providers/index.js';

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
