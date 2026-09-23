import assert from 'node:assert/strict';
import test from 'node:test';

import { AnthropicProvider } from '../../dist/providers/anthropic.js';
import { CohereProvider } from '../../dist/providers/cohere.js';
import { OpenAICompatibleProvider } from '../../dist/providers/openai-compatible.js';
import { DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS } from '../../dist/providers/request.js';

const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;

function timeoutPattern(label) {
  return new RegExp(`${label} timed out after ${DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS}ms`);
}

function setupStalledResponse(t, status = 200) {
  let cancelled = false;
  let aborted = false;

  globalThis.fetch = async (_url, init = {}) =>
    new Response(
      new ReadableStream({
        start(stream) {
          init.signal?.addEventListener(
            'abort',
            () => {
              aborted = true;
            },
            { once: true },
          );
          // Simulate headers plus a partial JSON body with no completion.
          stream.enqueue(new TextEncoder().encode('{"partial":'));
        },
        cancel() {
          cancelled = true;
        },
      }),
      { status, headers: { 'Content-Type': 'application/json' } },
    );

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  return () => ({ cancelled, aborted });
}

async function assertBodyTimeout(t, promise, pattern) {
  await new Promise((resolve) => originalSetTimeout(resolve, 0));
  t.mock.timers.tick(DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS);
  await assert.rejects(promise, pattern);
}

test('OpenAI-compatible complete times out when the JSON body stalls after headers arrive', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const state = setupStalledResponse(t);
  const provider = new OpenAICompatibleProvider();

  const pending = provider.complete({
    model: 'gpt-test',
    baseUrl: 'https://openai.example.com/v1',
    apiKey: 'test-key',
    messages: [{ role: 'user', content: 'hello' }],
  });

  await assertBodyTimeout(
    t,
    pending,
    timeoutPattern('OpenAI-compatible API response'),
  );

  assert.deepEqual(state(), { cancelled: true, aborted: true });
});

test('OpenAI-compatible complete preserves response-body timeout errors', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const state = setupStalledResponse(t, 500);
  const provider = new OpenAICompatibleProvider();

  const pending = provider.complete({
    model: 'gpt-test',
    baseUrl: 'https://openai.example.com/v1',
    apiKey: 'test-key',
    messages: [{ role: 'user', content: 'hello' }],
  });

  await assertBodyTimeout(
    t,
    pending,
    timeoutPattern('OpenAI-compatible API response'),
  );

  assert.deepEqual(state(), { cancelled: true, aborted: true });
});

test('OpenAI-compatible fetchModels times out when the JSON body stalls after headers arrive', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const state = setupStalledResponse(t);
  const provider = new OpenAICompatibleProvider();

  const pending = provider.fetchModels('https://openai.example.com/v1', 'test-key');

  await assertBodyTimeout(
    t,
    pending,
    timeoutPattern('OpenAI-compatible model response'),
  );

  assert.deepEqual(state(), { cancelled: true, aborted: true });
});

test('Anthropic complete times out when the JSON body stalls after headers arrive', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const state = setupStalledResponse(t);
  const provider = new AnthropicProvider();

  const pending = provider.complete({
    model: 'claude-test',
    baseUrl: 'https://anthropic.example.com',
    apiKey: 'test-key',
    messages: [{ role: 'user', content: 'hello' }],
  });

  await assertBodyTimeout(
    t,
    pending,
    timeoutPattern('Anthropic API response'),
  );

  assert.deepEqual(state(), { cancelled: true, aborted: true });
});

test('Anthropic complete preserves response-body timeout errors', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const state = setupStalledResponse(t, 500);
  const provider = new AnthropicProvider();

  const pending = provider.complete({
    model: 'claude-test',
    baseUrl: 'https://anthropic.example.com',
    apiKey: 'test-key',
    messages: [{ role: 'user', content: 'hello' }],
  });

  await assertBodyTimeout(
    t,
    pending,
    timeoutPattern('Anthropic API response'),
  );

  assert.deepEqual(state(), { cancelled: true, aborted: true });
});

test('Cohere complete times out when the JSON body stalls after headers arrive', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const state = setupStalledResponse(t);
  const provider = new CohereProvider();

  const pending = provider.complete({
    model: 'command-r',
    baseUrl: 'https://cohere.example.com',
    apiKey: 'test-key',
    messages: [{ role: 'user', content: 'hello' }],
  });

  await assertBodyTimeout(
    t,
    pending,
    timeoutPattern('Cohere API response'),
  );

  assert.deepEqual(state(), { cancelled: true, aborted: true });
});

test('Cohere complete preserves response-body timeout errors', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const state = setupStalledResponse(t, 500);
  const provider = new CohereProvider();

  const pending = provider.complete({
    model: 'command-r',
    baseUrl: 'https://cohere.example.com',
    apiKey: 'test-key',
    messages: [{ role: 'user', content: 'hello' }],
  });

  await assertBodyTimeout(
    t,
    pending,
    timeoutPattern('Cohere API response'),
  );

  assert.deepEqual(state(), { cancelled: true, aborted: true });
});

test('Cohere fetchModels times out when the JSON body stalls after headers arrive', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const state = setupStalledResponse(t);
  const provider = new CohereProvider();

  const pending = provider.fetchModels('https://cohere.example.com', 'test-key');

  await assertBodyTimeout(
    t,
    pending,
    timeoutPattern('Cohere model response'),
  );

  assert.deepEqual(state(), { cancelled: true, aborted: true });
});
