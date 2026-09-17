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

test('parseOpenAiSseLine falls back to reasoning content', () => {
  const result = parseOpenAiSseLine(
    'data: {"choices":[{"delta":{"reasoning_content":"thinking"}}]}',
  );

  assert.equal(result.text, 'thinking');
});

test('parseOpenAiSseLine prefers visible content over reasoning content', () => {
  const result = parseOpenAiSseLine(
    'data: {"choices":[{"delta":{"content":"answer","reasoning_content":"thinking"}}]}',
  );

  assert.equal(result.text, 'answer');
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
  const originalFetch = globalThis.fetch;
  const provider = new AnthropicProvider();

  globalThis.fetch = async () =>
    new Response(
      streamFromChunks([
        'event: content_block_delta\n',
        'data: {"delta":{"text":"hi"}}\n',
        'event: message_stop\n',
        'data: {}\n',
      ]),
      { status: 200 },
    );

  try {
    const chunks = [];
    for await (const chunk of provider.completeStream({
      model: 'claude-sonnet-4',
      messages: [{ role: 'user', content: 'test' }],
      apiKey: 'test-key',
      baseUrl: 'https://api.anthropic.com/v1',
    })) {
      chunks.push(chunk);
    }

    assert.deepEqual(chunks, [{ kind: 'text', text: 'hi' }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('OpenAI completeStream emits reasoning-only deltas as text', async () => {
  const originalFetch = globalThis.fetch;
  const provider = new OpenAICompatibleProvider();

  globalThis.fetch = async () =>
    new Response(
      streamFromChunks([
        'data: {"choices":[{"delta":{"reasoning_content":"thinking"}}]}\n',
        'data: [DONE]\n',
      ]),
      { status: 200 },
    );

  try {
    const chunks = [];
    for await (const chunk of provider.completeStream({
      model: 'o3-mini',
      messages: [{ role: 'user', content: 'test' }],
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.com/v1',
    })) {
      chunks.push(chunk);
    }

    assert.deepEqual(chunks, [{ kind: 'text', text: 'thinking' }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('OpenAI completeStream processes final line without trailing newline', async () => {
  const originalFetch = globalThis.fetch;
  const provider = new OpenAICompatibleProvider();

  globalThis.fetch = async () =>
    new Response(
      streamFromChunks([
        'data: {"choices":[{"delta":{"content":"hel"}}]}\n',
        'data: {"choices":[{"delta":{"content":"lo"}}]}',
      ]),
      { status: 200 },
    );

  try {
    const chunks = [];
    for await (const chunk of provider.completeStream({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'test' }],
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.com/v1',
    })) {
      chunks.push(chunk);
    }

    assert.deepEqual(chunks, [
      { kind: 'text', text: 'hel' },
      { kind: 'text', text: 'lo' },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('OpenAI completeStream handles [DONE] in final buffer without trailing newline', async () => {
  const originalFetch = globalThis.fetch;
  const provider = new OpenAICompatibleProvider();

  globalThis.fetch = async () =>
    new Response(
      streamFromChunks([
        'data: {"choices":[{"delta":{"content":"done"}}]}\n',
        'data: [DONE]',
      ]),
      { status: 200 },
    );

  try {
    const chunks = [];
    for await (const chunk of provider.completeStream({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'test' }],
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.com/v1',
    })) {
      chunks.push(chunk);
    }

    assert.deepEqual(chunks, [{ kind: 'text', text: 'done' }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
