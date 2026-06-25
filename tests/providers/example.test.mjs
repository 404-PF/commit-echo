import assert from 'node:assert/strict';
import test from 'node:test';

import { ExampleProvider } from '../../dist/providers/example.js';

const originalSetTimeout = globalThis.setTimeout;

function forceImmediateTimeout(t) {
  globalThis.setTimeout = (callback, _delay, ...args) =>
    originalSetTimeout(callback, 0, ...args);

  t.after(() => {
    globalThis.setTimeout = originalSetTimeout;
  });
}

async function collectChunks(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

test('ExampleProvider complete returns a ChatResult with the model and canned content', async () => {
  const provider = new ExampleProvider();

  const result = await provider.complete({
    model: 'test-model',
    baseUrl: '',
    apiKey: '',
    messages: [{ role: 'user', content: 'hello' }],
  });

  assert.equal(result.model, 'test-model');
  assert.ok(result.content.includes('chore: example commit message from test-model'));
  assert.ok(result.content.includes('canned response'));
  assert.ok(result.content.includes('No API key was required'));
});

test('ExampleProvider complete uses the provided model name in the response', async () => {
  const provider = new ExampleProvider();

  const result = await provider.complete({
    model: 'custom-llm',
    baseUrl: '',
    apiKey: '',
    messages: [{ role: 'user', content: 'generate' }],
  });

  assert.equal(result.model, 'custom-llm');
  assert.ok(result.content.includes('custom-llm'));
});

test('ExampleProvider completeStream yields model and text chunks', async () => {
  const provider = new ExampleProvider();

  const chunks = await collectChunks(
    provider.completeStream({
      model: 'stream-model',
      baseUrl: '',
      apiKey: '',
      messages: [{ role: 'user', content: 'hello' }],
    }),
  );

  assert.ok(chunks.length >= 2);
  assert.equal(chunks[0].kind, 'model');
  assert.equal(chunks[0].model, 'stream-model');

  const textChunks = chunks.filter((c) => c.kind === 'text');
  assert.ok(textChunks.length > 0);

  const fullText = textChunks.map((c) => c.text).join('');
  assert.ok(fullText.includes('chore: example streamed commit from stream-model'));
});

test('ExampleProvider completeStream chunks text into segments', async () => {
  const provider = new ExampleProvider();

  const chunks = await collectChunks(
    provider.completeStream({
      model: 'm',
      baseUrl: '',
      apiKey: '',
      messages: [{ role: 'user', content: 'hello' }],
    }),
  );

  const textChunks = chunks.filter((c) => c.kind === 'text');
  for (const chunk of textChunks) {
    assert.ok(chunk.text.length <= 5, `Chunk "${chunk.text}" exceeds 5 characters`);
  }
});

test('ExampleProvider fetchModels returns three example models', async () => {
  const provider = new ExampleProvider();

  const models = await provider.fetchModels('', '');

  assert.equal(models.length, 3);
  assert.ok(models.includes('example-model-1'));
  assert.ok(models.includes('example-model-2'));
  assert.ok(models.includes('example-model-3'));
});

test('ExampleProvider complete does not require an API key', async () => {
  const provider = new ExampleProvider();

  const result = await provider.complete({
    model: 'm',
    baseUrl: '',
    apiKey: '',
    messages: [{ role: 'user', content: 'hello' }],
  });

  assert.ok(result);
  assert.equal(typeof result.content, 'string');
});
