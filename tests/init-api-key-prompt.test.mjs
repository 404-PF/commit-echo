import assert from 'node:assert/strict';
import test from 'node:test';

import { buildApiKeyPrompt } from '../dist/commands/init.js';

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
