import assert from 'node:assert/strict';
import test from 'node:test';

import { AnthropicProvider } from '../../dist/providers/anthropic.js';
import { CohereProvider } from '../../dist/providers/cohere.js';
import { OpenAICompatibleProvider } from '../../dist/providers/openai-compatible.js';

const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;

function mockFetch(t, implementation) {
  globalThis.fetch = implementation;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
}

function forceImmediateTimeout(t) {
  globalThis.setTimeout = (callback, _delay, ...args) =>
    originalSetTimeout(callback, 0, ...args);

  t.after(() => {
    globalThis.setTimeout = originalSetTimeout;
  });
}

function readJsonBody(init) {
  return JSON.parse(String(init?.body ?? '{}'));
}

function abortOnSignal() {
  return async (_url, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener(
        'abort',
        () => reject(new DOMException('Aborted', 'AbortError')),
        { once: true },
      );
    });
}

async function collectChunks(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

test('AnthropicProvider complete builds the expected request and trims the response', async (t) => {
  const provider = new AnthropicProvider();
  const requestLog = [];

  mockFetch(t, async (url, init) => {
    requestLog.push({ url, init });
    return new Response(
      JSON.stringify({
        content: [{ type: 'text', text: '  concise answer  ' }],
        model: 'claude-test',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  });

  const result = await provider.complete({
    model: 'claude-test',
    baseUrl: 'https://anthropic.example.com/',
    apiKey: 'test-key',
    temperature: 0.2,
    maxTokens: 256,
    messages: [
      { role: 'system', content: 'Be concise.' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
      { role: 'user', content: 'summarize this' },
    ],
  });

  assert.equal(requestLog.length, 1);
  assert.equal(requestLog[0].url, 'https://anthropic.example.com/messages');
  assert.equal(requestLog[0].init?.headers['x-api-key'], 'test-key');
  assert.equal(requestLog[0].init?.headers['anthropic-version'], '2023-06-01');
  assert.deepEqual(readJsonBody(requestLog[0].init), {
    model: 'claude-test',
    messages: [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
      { role: 'user', content: 'summarize this' },
    ],
    max_tokens: 256,
    temperature: 0.2,
    system: 'Be concise.',
  });
  assert.deepEqual(result, {
    content: 'concise answer',
    model: 'claude-test',
  });
});

test('AnthropicProvider complete surfaces API errors with the response body', async (t) => {
  const provider = new AnthropicProvider();

  mockFetch(
    t,
    async () => new Response('invalid request', { status: 400, statusText: 'Bad Request' }),
  );

  await assert.rejects(
    provider.complete({
      model: 'claude-test',
      baseUrl: 'https://anthropic.example.com',
      apiKey: 'test-key',
      messages: [{ role: 'user', content: 'hello' }],
    }),
    /Anthropic API error \(400\): invalid request/,
  );
});

test('AnthropicProvider complete rejects empty text responses', async (t) => {
  const provider = new AnthropicProvider();

  mockFetch(
    t,
    async () =>
      new Response(JSON.stringify({ content: [{ type: 'tool_use', text: '' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  );

  await assert.rejects(
    provider.complete({
      model: 'claude-test',
      baseUrl: 'https://anthropic.example.com',
      apiKey: 'test-key',
      messages: [{ role: 'user', content: 'hello' }],
    }),
    /Anthropic returned empty response\./,
  );
});

test('AnthropicProvider complete reports request timeouts', async (t) => {
  const provider = new AnthropicProvider();

  forceImmediateTimeout(t);
  mockFetch(t, abortOnSignal());

  await assert.rejects(
    provider.complete({
      model: 'claude-test',
      baseUrl: 'https://anthropic.example.com',
      apiKey: 'test-key',
      messages: [{ role: 'user', content: 'hello' }],
    }),
    /Anthropic API request timed out after 30000ms/,
  );
});

test('AnthropicProvider completeStream parses model and text SSE events', async (t) => {
  const provider = new AnthropicProvider();

  mockFetch(
    t,
    async () =>
      new Response(
        [
          'event: message_start',
          'data: {"message":{"model":"claude-stream"}}',
          'event: content_block_delta',
          'data: {"delta":{"text":"hello"}}',
          'event: content_block_delta',
          'data: {"delta":{"text":" world"}}',
          'event: message_stop',
          'data: {}',
        ].join('\n'),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ),
  );

  const chunks = await collectChunks(
    provider.completeStream({
      model: 'claude-test',
      baseUrl: 'https://anthropic.example.com',
      apiKey: 'test-key',
      messages: [{ role: 'user', content: 'hello' }],
    }),
  );

  assert.deepEqual(chunks, [
    { kind: 'model', model: 'claude-stream' },
    { kind: 'text', text: 'hello' },
    { kind: 'text', text: ' world' },
  ]);
});

test('CohereProvider complete builds chat history and trims the response text', async (t) => {
  const provider = new CohereProvider();
  const requestLog = [];

  mockFetch(t, async (url, init) => {
    requestLog.push({ url, init });
    return new Response(JSON.stringify({ text: '  commit message  ' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  const result = await provider.complete({
    model: 'command-r',
    baseUrl: 'https://cohere.example.com/',
    apiKey: 'test-key',
    temperature: 0.3,
    maxTokens: 200,
    messages: [
      { role: 'system', content: 'Be sharp.' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
      { role: 'user', content: 'write a summary' },
    ],
  });

  assert.equal(requestLog.length, 1);
  assert.equal(requestLog[0].url, 'https://cohere.example.com/chat');
  assert.equal(requestLog[0].init?.headers.Authorization, 'Bearer test-key');
  assert.deepEqual(readJsonBody(requestLog[0].init), {
    model: 'command-r',
    message: 'write a summary',
    chat_history: [
      { role: 'USER', message: 'hello' },
      { role: 'CHATBOT', message: 'hi' },
    ],
    temperature: 0.3,
    max_tokens: 200,
    preamble: 'Be sharp.',
  });
  assert.deepEqual(result, {
    content: 'commit message',
    model: 'command-r',
  });
});

test('CohereProvider complete surfaces API errors with the response body', async (t) => {
  const provider = new CohereProvider();

  mockFetch(
    t,
    async () => new Response('rate limited', { status: 429, statusText: 'Too Many Requests' }),
  );

  await assert.rejects(
    provider.complete({
      model: 'command-r',
      baseUrl: 'https://cohere.example.com',
      apiKey: 'test-key',
      messages: [{ role: 'user', content: 'hello' }],
    }),
    /Cohere API error \(429\): rate limited/,
  );
});

test('CohereProvider complete rejects empty text responses', async (t) => {
  const provider = new CohereProvider();

  mockFetch(
    t,
    async () =>
      new Response(JSON.stringify({ text: '' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  );

  await assert.rejects(
    provider.complete({
      model: 'command-r',
      baseUrl: 'https://cohere.example.com',
      apiKey: 'test-key',
      messages: [{ role: 'user', content: 'hello' }],
    }),
    /Cohere returned empty response\./,
  );
});

test('CohereProvider complete reports request timeouts', async (t) => {
  const provider = new CohereProvider();

  forceImmediateTimeout(t);
  mockFetch(t, abortOnSignal());

  await assert.rejects(
    provider.complete({
      model: 'command-r',
      baseUrl: 'https://cohere.example.com',
      apiKey: 'test-key',
      messages: [{ role: 'user', content: 'hello' }],
    }),
    /Cohere API request timed out after 30000ms/,
  );
});

test('OpenAICompatibleProvider complete forwards messages and trims the first choice', async (t) => {
  const provider = new OpenAICompatibleProvider();
  const requestLog = [];

  mockFetch(t, async (url, init) => {
    requestLog.push({ url, init });
    return new Response(
      JSON.stringify({
        model: 'gpt-test',
        choices: [{ message: { content: '  polished answer  ' } }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  });

  const messages = [
    { role: 'system', content: 'Follow the repo style.' },
    { role: 'user', content: 'Draft a commit message.' },
  ];

  const result = await provider.complete({
    model: 'gpt-test',
    baseUrl: 'https://openai.example.com/v1/',
    apiKey: 'test-key',
    temperature: 0.1,
    maxTokens: 128,
    messages,
  });

  assert.equal(requestLog.length, 1);
  assert.equal(requestLog[0].url, 'https://openai.example.com/v1/chat/completions');
  assert.equal(requestLog[0].init?.headers.Authorization, 'Bearer test-key');
  assert.deepEqual(readJsonBody(requestLog[0].init), {
    model: 'gpt-test',
    messages,
    temperature: 0.1,
    max_tokens: 128,
  });
  assert.deepEqual(result, {
    content: 'polished answer',
    model: 'gpt-test',
  });
});

test('OpenAICompatibleProvider complete surfaces API errors with the response body', async (t) => {
  const provider = new OpenAICompatibleProvider();

  mockFetch(
    t,
    async () => new Response('server exploded', { status: 500, statusText: 'Server Error' }),
  );

  await assert.rejects(
    provider.complete({
      model: 'gpt-test',
      baseUrl: 'https://openai.example.com/v1',
      apiKey: 'test-key',
      messages: [{ role: 'user', content: 'hello' }],
    }),
    /OpenAI-compatible API error \(500\): server exploded/,
  );
});

test('OpenAICompatibleProvider complete rejects empty choices', async (t) => {
  const provider = new OpenAICompatibleProvider();

  mockFetch(
    t,
    async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  );

  await assert.rejects(
    provider.complete({
      model: 'gpt-test',
      baseUrl: 'https://openai.example.com/v1',
      apiKey: 'test-key',
      messages: [{ role: 'user', content: 'hello' }],
    }),
    /LLM returned empty response\./,
  );
});

test('OpenAICompatibleProvider complete reports request timeouts', async (t) => {
  const provider = new OpenAICompatibleProvider();

  forceImmediateTimeout(t);
  mockFetch(t, abortOnSignal());

  await assert.rejects(
    provider.complete({
      model: 'gpt-test',
      baseUrl: 'https://openai.example.com/v1',
      apiKey: 'test-key',
      messages: [{ role: 'user', content: 'hello' }],
    }),
    /OpenAI-compatible API request timed out after 30000ms/,
  );
});

test('OpenAICompatibleProvider completeStream parses streaming chunks and stops at DONE', async (t) => {
  const provider = new OpenAICompatibleProvider();

  mockFetch(
    t,
    async () =>
      new Response(
        [
          'data: {"model":"gpt-stream","choices":[{"delta":{"content":"hello"}}]}',
          'data: {"choices":[{"delta":{"content":" world"}}]}',
          'data: [DONE]',
        ].join('\n'),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ),
  );

  const chunks = await collectChunks(
    provider.completeStream({
      model: 'gpt-test',
      baseUrl: 'https://openai.example.com/v1',
      apiKey: 'test-key',
      messages: [{ role: 'user', content: 'hello' }],
    }),
  );

  assert.deepEqual(chunks, [
    { kind: 'model', model: 'gpt-stream' },
    { kind: 'text', text: 'hello' },
    { kind: 'text', text: ' world' },
  ]);
});
