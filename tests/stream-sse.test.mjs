import assert from 'node:assert/strict';
import test from 'node:test';

import { parseAnthropicSseLine, parseOpenAiSseLine, SSE_STREAM_END, streamSseResponse } from '../dist/providers/sse.js';
import { AnthropicProvider } from '../dist/providers/anthropic.js';
import { OpenAICompatibleProvider } from '../dist/providers/openai-compatible.js';
import { streamFromChunks } from './helpers/stream-from-chunks.mjs';

const OPENAI_TEST_PARAMS = {
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'test' }],
  apiKey: 'test-key',
  baseUrl: 'https://api.openai.com/v1',
};

async function withMockedFetch(fetchImpl, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function responseFromChunks(chunks) {
  return new Response(streamFromChunks(chunks), { status: 200 });
}

async function collectChunks(provider, params) {
  const chunks = [];
  for await (const chunk of provider.completeStream(params)) {
    chunks.push(chunk);
  }
  return chunks;
}

test('an SSE read that stalls after a partial result times out and aborts the request', async () => {
  const controller = new AbortController();
  let cancelled = false;
  let streamController;
  const response = new Response(
    new ReadableStream({
      start(stream) {
        streamController = stream;
        stream.enqueue(new TextEncoder().encode('data: first\n'));
      },
      cancel() {
        cancelled = true;
      },
    }),
  );
  const chunks = [];
  // Keep a broken implementation from leaving an unbounded read in the test runner.
  const watchdog = setTimeout(() => {
    if (!cancelled) streamController.close();
  }, 250);

  try {
    await assert.rejects(async () => {
      for await (const chunk of streamSseResponse(
        response,
        (line) => (line.startsWith('data:') ? { kind: 'text', text: line.slice(6) } : null),
        { controller, timeoutMs: 20, label: 'Test stream' },
      )) {
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
  const response = new Response(
    new ReadableStream({
      start(stream) {
        stream.enqueue(new TextEncoder().encode('data: first\n'));
      },
      cancel() {
        cancelled = true;
      },
    }),
  );

  for await (const _chunk of streamSseResponse(
    response,
    (line) => (line.startsWith('data:') ? { kind: 'text', text: line.slice(6) } : null),
    { controller, timeoutMs: 20 },
  )) {
    break;
  }
  assert.equal(cancelled, true);
  assert.equal(controller.signal.aborted, true);
  assert.equal(response.body.locked, false);
});

test('parseOpenAiSseLine extracts delta content', () => {
  const result = parseOpenAiSseLine('data: {"choices":[{"delta":{"content":"hello"}}]}');

  assert.equal(result.text, 'hello');
});

test('parseOpenAiSseLine extracts model from stream chunk', () => {
  const result = parseOpenAiSseLine('data: {"model":"gpt-4o","choices":[{"delta":{"content":"hello"}}]}');

  assert.equal(result.model, 'gpt-4o');
  assert.equal(result.text, 'hello');
});

test('parseOpenAiSseLine rejects malformed data chunks', () => {
  assert.throws(() => parseOpenAiSseLine('data: {not valid JSON}'), /Malformed OpenAI SSE data: invalid JSON/);
});

test('parseOpenAiSseLine ignores valid JSON with an unsupported payload shape', () => {
  assert.deepEqual(parseOpenAiSseLine('data: null'), {});
});

test('parseOpenAiSseLine ignores valid JSON objects with unsupported payload shapes', () => {
  assert.deepEqual(parseOpenAiSseLine('data: {"unexpected":"value"}'), {});
  assert.deepEqual(parseOpenAiSseLine('data: {"choices":[]}'), {});
});

test('parseOpenAiSseLine ignores empty data payloads', () => {
  assert.deepEqual(parseOpenAiSseLine('data:'), {});
  assert.deepEqual(parseOpenAiSseLine('data:   '), {});
});

test('parseOpenAiSseLine detects stream completion', () => {
  assert.deepEqual(parseOpenAiSseLine('data: [DONE]'), { done: true });
});

test('parseOpenAiSseLine surfaces API errors', () => {
  const result = parseOpenAiSseLine('data: {"error":{"message":"rate limited"}}');

  assert.equal(result.error, 'rate limited');
});

test('parseAnthropicSseLine handles event and data split across batches', () => {
  const state = { currentEvent: '' };

  const eventResult = parseAnthropicSseLine('event: content_block_delta', state);
  assert.equal(eventResult, null);

  assert.equal(state.currentEvent, 'content_block_delta');

  const dataResult = parseAnthropicSseLine('data: {"delta":{"text":"hello"}}', state);
  assert.deepEqual(dataResult, { kind: 'text', text: 'hello' });
});

test('parseAnthropicSseLine extracts model from message_start', () => {
  const state = { currentEvent: '' };
  parseAnthropicSseLine('event: message_start', state);
  const result = parseAnthropicSseLine('data: {"type":"message_start","message":{"model":"claude-sonnet-4"}}', state);
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
  assert.throws(() => parseAnthropicSseLine('data: {"error":{"message":"overloaded"}}', state), /overloaded/);
});

test('Anthropic completeStream reassembles event/data split across network chunks', async () => {
  await withMockedFetch(
    async () =>
      responseFromChunks([
        'event: content_block_delta\n',
        'data: {"delta":{"text":"hi"}}\n',
        'event: message_stop\n',
        'data: {}\n',
      ]),
    async () => {
      const chunks = await collectChunks(new AnthropicProvider(), {
        model: 'claude-sonnet-4',
        messages: [{ role: 'user', content: 'test' }],
        apiKey: 'test-key',
        baseUrl: 'https://api.anthropic.com/v1',
      });

      assert.deepEqual(chunks, [{ kind: 'text', text: 'hi' }]);
    },
  );
});

test('OpenAI completeStream processes final line without trailing newline', async () => {
  await withMockedFetch(
    async () =>
      responseFromChunks([
        'data: {"choices":[{"delta":{"content":"hel"}}]}\n',
        'data: {"choices":[{"delta":{"content":"lo"}}]}',
      ]),
    async () => {
      const chunks = await collectChunks(new OpenAICompatibleProvider(), OPENAI_TEST_PARAMS);

      assert.deepEqual(chunks, [
        { kind: 'text', text: 'hel' },
        { kind: 'text', text: 'lo' },
      ]);
    },
  );
});

test('OpenAI completeStream ignores empty data keepalive events', async () => {
  await withMockedFetch(
    async () => responseFromChunks(['data:\n', 'data: {"choices":[{"delta":{"content":"hello"}}]}\n', 'data: [DONE]']),
    async () => {
      const chunks = await collectChunks(new OpenAICompatibleProvider(), OPENAI_TEST_PARAMS);

      assert.deepEqual(chunks, [{ kind: 'text', text: 'hello' }]);
    },
  );
});

test('OpenAI completeStream propagates malformed JSON and releases the response stream', async () => {
  let cancelled = false;
  const response = new Response(
    new ReadableStream({
      start(stream) {
        stream.enqueue(
          new TextEncoder().encode(
            'data: {"choices":[{"delta":{"content":"before"}}]}\n' + 'data: {not valid JSON}\n',
          ),
        );
      },
      cancel() {
        cancelled = true;
      },
    }),
    { status: 200 },
  );

  await withMockedFetch(
    async () => response,
    async () => {
      const iterator = new OpenAICompatibleProvider().completeStream(OPENAI_TEST_PARAMS)[Symbol.asyncIterator]();
      assert.deepEqual(await iterator.next(), { done: false, value: { kind: 'text', text: 'before' } });
      await assert.rejects(() => iterator.next(), /Malformed OpenAI SSE data: invalid JSON/);

      assert.equal(cancelled, true);
      assert.equal(response.body.locked, false);
    },
  );
});

test('OpenAI completeStream handles [DONE] in final buffer without trailing newline', async () => {
  await withMockedFetch(
    async () => responseFromChunks(['data: {"choices":[{"delta":{"content":"done"}}]}\n', 'data: [DONE]']),
    async () => {
      const chunks = await collectChunks(new OpenAICompatibleProvider(), OPENAI_TEST_PARAMS);

      assert.deepEqual(chunks, [{ kind: 'text', text: 'done' }]);
    },
  );
});
