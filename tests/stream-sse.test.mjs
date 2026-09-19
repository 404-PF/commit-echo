import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseAnthropicSseLine,
  parseOpenAiSseLine,
  SSE_STREAM_END,
  streamSseResponse,
} from '../dist/providers/sse.js';
import { AnthropicProvider } from '../dist/providers/anthropic.js';
import { OpenAICompatibleProvider } from '../dist/providers/openai-compatible.js';
import { streamFromChunks } from './helpers/stream-from-chunks.mjs';

const openAiParams = (model = 'o3-mini') => ({
  model,
  messages: [{ role: 'user', content: 'test' }],
  apiKey: 'test-key',
  baseUrl: 'https://api.openai.com/v1',
});

const anthropicParams = {
  model: 'claude-sonnet-4',
  messages: [{ role: 'user', content: 'test' }],
  apiKey: 'test-key',
  baseUrl: 'https://api.anthropic.com/v1',
};

async function collectStream(provider, params) {
  const chunks = [];
  for await (const chunk of provider.completeStream(params)) {
    chunks.push(chunk);
  }
  return chunks;
}

async function collectWithMockedFetch(provider, chunks, params) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(streamFromChunks(chunks), { status: 200 });

  try {
    return await collectStream(provider, params);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function collectWithMockedFetchSequence(provider, responses, paramsList) {
  const originalFetch = globalThis.fetch;
  let responseIndex = 0;
  globalThis.fetch = async () => new Response(streamFromChunks(responses[responseIndex++]), { status: 200 });

  try {
    const results = [];
    for (const params of paramsList) {
      results.push(await collectStream(provider, params));
    }
    return results;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('an SSE read that stalls after a partial result times out and aborts the request', async () => {
  const controller = new AbortController();
  let cancelled = false;
  let streamController;
  const response = new Response(new ReadableStream({
    start(stream) {
      streamController = stream;
      stream.enqueue(new TextEncoder().encode('data: first\n'));
    },
    cancel() {
      cancelled = true;
    },
  }));
  const chunks = [];
  // Keep a broken implementation from leaving an unbounded read in the test runner.
  const watchdog = setTimeout(() => { if (!cancelled) streamController.close(); }, 250);

  try {
    await assert.rejects(async () => {
      for await (const chunk of streamSseResponse(response, (line) =>
        line.startsWith('data:') ? { kind: 'text', text: line.slice(6) } : null,
        { controller, timeoutMs: 20, label: 'Test stream' })) {
        chunks.push(chunk);
      }
    }, /Test stream timed out after 20ms/);
    assert.deepEqual(chunks, [{ kind: 'text', text: 'first' }]);
    assert.equal(controller.signal.aborted, true);
    assert.equal(cancelled, true);
    assert.equal(response.body.locked, false);
  } finally {
    clearTimeout(watchdog);
  }
});

test('SSE consumption releases the network stream when the consumer stops early', async () => {
  const controller = new AbortController();
  let cancelled = false;
  const response = new Response(new ReadableStream({
    start(stream) {
      stream.enqueue(new TextEncoder().encode('data: first\n'));
    },
    cancel() {
      cancelled = true;
    },
  }));

  for await (const _chunk of streamSseResponse(response, (line) =>
    line.startsWith('data:') ? { kind: 'text', text: line.slice(6) } : null,
    { controller, timeoutMs: 20 })) {
    break;
  }
  assert.equal(cancelled, true);
  assert.equal(controller.signal.aborted, true);
  assert.equal(response.body.locked, false);
});

test('SSE reader rejects oversized lines before parsing them', async () => {
  const response = new Response(streamFromChunks(['data: too long\n']));
  let parsed = false;

  await assert.rejects(
    (async () => {
      for await (const _chunk of streamSseResponse(
        response,
        () => {
          parsed = true;
          return null;
        },
        { maxLineLength: 8, label: 'Test stream' },
      )) {
        // The oversized line should be rejected before this loop yields.
      }
    })(),
    /Test stream exceeded the maximum SSE line length of 8 characters/,
  );
  assert.equal(parsed, false);
});

test('parseOpenAiSseLine extracts delta content', () => {
  const result = parseOpenAiSseLine(
    'data: {"choices":[{"delta":{"content":"hello"}}]}',
  );

  assert.equal(result.text, 'hello');
});

test('parseOpenAiSseLine extracts model from stream chunk', () => {
  const result = parseOpenAiSseLine(
    'data: {"model":"gpt-4o","choices":[{"delta":{"content":"hello"}}]}',
  );

  assert.equal(result.model, 'gpt-4o');
  assert.equal(result.text, 'hello');
});

test('parseOpenAiSseLine extracts reasoning content separately', () => {
  const result = parseOpenAiSseLine(
    'data: {"choices":[{"delta":{"reasoning_content":"thinking"}}]}',
  );

  assert.equal(result.reasoning, 'thinking');
});

test('parseOpenAiSseLine prefers visible content over reasoning content', () => {
  const result = parseOpenAiSseLine(
    'data: {"choices":[{"delta":{"content":"answer","reasoning_content":"thinking"}}]}',
  );

  assert.equal(result.text, 'answer');
  assert.equal(result.reasoning, undefined);

  const reasoningAfterEmptyContent = parseOpenAiSseLine(
    'data: {"choices":[{"delta":{"content":"","reasoning_content":"thinking"}}]}',
  );
  assert.equal(reasoningAfterEmptyContent.text, undefined);
  assert.equal(reasoningAfterEmptyContent.reasoning, 'thinking');
});

test('parseOpenAiSseLine detects stream completion', () => {
  assert.deepEqual(parseOpenAiSseLine('data: [DONE]'), { done: true });
});

test('parseOpenAiSseLine surfaces API errors', () => {
  const result = parseOpenAiSseLine(
    'data: {"error":{"message":"rate limited"}}',
  );

  assert.equal(result.error, 'rate limited');
});

test('parseAnthropicSseLine handles event and data split across batches', () => {
  const state = { currentEvent: '' };

  const eventResult = parseAnthropicSseLine('event: content_block_delta', state);
  assert.equal(eventResult, null);

  assert.equal(state.currentEvent, 'content_block_delta');

  const dataResult = parseAnthropicSseLine(
    'data: {"delta":{"text":"hello"}}',
    state,
  );
  assert.deepEqual(dataResult, { kind: 'text', text: 'hello' });
});

test('parseAnthropicSseLine extracts model from message_start', () => {
  const state = { currentEvent: '' };
  parseAnthropicSseLine('event: message_start', state);
  const result = parseAnthropicSseLine(
    'data: {"type":"message_start","message":{"model":"claude-sonnet-4"}}',
    state,
  );
  assert.deepEqual(result, { kind: 'model', model: 'claude-sonnet-4' });
});

test('parseAnthropicSseLine returns SSE_STREAM_END on message_stop', () => {
  const state = { currentEvent: '' };
  parseAnthropicSseLine('event: message_stop', state);
  const result = parseAnthropicSseLine('data: {}', state);
  assert.equal(result, SSE_STREAM_END);
});

test('parseAnthropicSseLine throws on error events', () => {
  const state = { currentEvent: '' };
  parseAnthropicSseLine('event: error', state);
  assert.throws(
    () => parseAnthropicSseLine('data: {"error":{"message":"overloaded"}}', state),
    /overloaded/,
  );
});

test('Anthropic completeStream reassembles event/data split across network chunks', async () => {
  const provider = new AnthropicProvider();
  const chunks = await collectWithMockedFetch(
    provider,
    [
      'event: content_block_delta\n',
      'data: {"delta":{"text":"hi"}}\n',
      'event: message_stop\n',
      'data: {}\n',
    ],
    anthropicParams,
  );
  assert.deepEqual(chunks, [{ kind: 'text', text: 'hi' }]);
});

test('OpenAI completeStream handles reasoning-only and visible-content precedence', async () => {
  const provider = new OpenAICompatibleProvider();
  const responses = [
    [
      'data: {"choices":[{"delta":{"reasoning_content":"think "}}]}\n',
      'data: {"choices":[{"delta":{"reasoning_content":"more"}}]}\n',
      'data: [DONE]\n',
    ],
    [
      'data: {"choices":[{"delta":{"reasoning_content":"thinking"}}]}\n',
      'data: {"choices":[{"delta":{"content":"answer"}}]}\n',
      'data: {"choices":[{"delta":{"reasoning_content":" leaked"}}]}\n',
      'data: [DONE]\n',
    ],
  ];

  const [reasoningChunks, visibleChunks] = await collectWithMockedFetchSequence(
    provider,
    responses,
    [openAiParams(), openAiParams()],
  );
  assert.deepEqual(reasoningChunks, [{ kind: 'text', text: 'think more' }]);
  assert.deepEqual(visibleChunks, [{ kind: 'text', text: 'answer' }]);
});

test('OpenAI completeStream emits reasoning after an EOF-terminated stream', async () => {
  const provider = new OpenAICompatibleProvider();
  const chunks = await collectWithMockedFetch(
    provider,
    [
      'data: {"choices":[{"delta":{"reasoning_content":"think "}}]}\n',
      'data: {"choices":[{"delta":{"reasoning_content":"more"}}]}',
    ],
    openAiParams(),
  );
  assert.deepEqual(chunks, [{ kind: 'text', text: 'think more' }]);
});

test('OpenAI completeStream processes final line without trailing newline', async () => {
  const provider = new OpenAICompatibleProvider();
  const chunks = await collectWithMockedFetch(
    provider,
    [
      'data: {"choices":[{"delta":{"content":"hel"}}]}\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}',
    ],
    openAiParams('gpt-4o'),
  );
  assert.deepEqual(chunks, [
    { kind: 'text', text: 'hel' },
    { kind: 'text', text: 'lo' },
  ]);
});

test('OpenAI completeStream handles [DONE] in final buffer without trailing newline', async () => {
  const provider = new OpenAICompatibleProvider();
  const chunks = await collectWithMockedFetch(
    provider,
    [
      'data: {"choices":[{"delta":{"content":"done"}}]}\n',
      'data: [DONE]',
    ],
    openAiParams('gpt-4o'),
  );
  assert.deepEqual(chunks, [{ kind: 'text', text: 'done' }]);
});

test('OpenAI completeStream rejects an oversized SSE line before JSON parsing', async () => {
  const provider = new OpenAICompatibleProvider();
  const reasoning = 'x'.repeat(1024 * 1024);

  await assert.rejects(
    collectWithMockedFetch(
      provider,
      [`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: reasoning } }] })}\n`],
      openAiParams(),
    ),
    /maximum SSE line length/,
  );
});

test('OpenAI completeStream rejects a reasoning buffer over 1 MiB', async () => {
  const provider = new OpenAICompatibleProvider();
  const reasoning = 'x'.repeat(2_048);
  const chunks = Array.from({ length: 600 }, () =>
    `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: reasoning } }] })}\n`,
  );

  await assert.rejects(
    collectWithMockedFetch(provider, chunks, openAiParams()),
    /reasoning stream exceeded the 1 MiB buffer limit/,
  );
});
