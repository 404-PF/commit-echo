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

const collectStream = collectChunks;

async function collectWithMockedFetch(provider, chunks, params) {
  return withMockedFetch(
    async () => responseFromChunks(chunks),
    () => collectChunks(provider, params),
  );
}

async function collectWithMockedFetchSequence(provider, responses, paramsList) {
  let responseIndex = 0;
  return withMockedFetch(
    async () => responseFromChunks(responses[responseIndex++]),
    async () => {
      const results = [];
      for (const params of paramsList) {
        results.push(await collectChunks(provider, params));
      }
      return results;
    },
  );
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

test('SSE array sentinel completes without aborting the request', async () => {
  const controller = new AbortController();
  let cancelled = false;
  const response = new Response(
    new ReadableStream({
      start(stream) {
        stream.enqueue(new TextEncoder().encode('data: stop\n'));
      },
      cancel() {
        cancelled = true;
      },
    }),
  );
  const chunks = [];

  for await (const chunk of streamSseResponse(
    response,
    () => [{ kind: 'text', text: 'before' }, SSE_STREAM_END],
    { controller },
  )) {
    chunks.push(chunk);
  }

  assert.deepEqual(chunks, [{ kind: 'text', text: 'before' }]);
  assert.equal(cancelled, true);
  assert.equal(controller.signal.aborted, false);
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

test('parseAnthropicSseLine rejects malformed message_start JSON', () => {
  const state = { currentEvent: '' };
  parseAnthropicSseLine('event: message_start', state);
  assert.throws(
    () => parseAnthropicSseLine('data: {not valid JSON}', state),
    /Malformed Anthropic SSE data: invalid JSON/,
  );
});

test('parseAnthropicSseLine rejects malformed content_block_delta JSON', () => {
  const state = { currentEvent: '' };
  parseAnthropicSseLine('event: content_block_delta', state);
  assert.throws(
    () => parseAnthropicSseLine('data: {not valid JSON}', state),
    /Malformed Anthropic SSE data: invalid JSON/,
  );
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

test('Anthropic completeStream propagates malformed JSON and releases the response stream', async () => {
  let cancelled = false;
  let malformedSent = false;
  let closeTimer;
  let sourceController;
  const response = new Response(
    new ReadableStream({
      start(controller) {
        sourceController = controller;
        controller.enqueue(new TextEncoder().encode('event: content_block_delta\n'));
      },
      pull(stream) {
        if (malformedSent) return;
        malformedSent = true;
        stream.enqueue(new TextEncoder().encode('data: {"delta":{"text":"before"}}\n'));
        stream.enqueue(new TextEncoder().encode('data: {not valid JSON}\n'));
        closeTimer = setTimeout(() => {
          if (!cancelled) sourceController.close();
        }, 100);
      },
      cancel() {
        cancelled = true;
        if (closeTimer) clearTimeout(closeTimer);
      },
    }),
    { status: 200 },
  );

  await withMockedFetch(
    async () => response,
    async () => {
      const iterator = new AnthropicProvider().completeStream(anthropicParams)[Symbol.asyncIterator]();
      assert.deepEqual(await iterator.next(), { done: false, value: { kind: 'text', text: 'before' } });
      await assert.rejects(() => iterator.next(), /Malformed Anthropic SSE data: invalid JSON/);

      assert.equal(cancelled, true);
      assert.equal(response.body.locked, false);
      await iterator.return?.().catch(() => {});
    },
  );
});
test('OpenAI completeStream emits reasoning progressively and keeps it separate from visible content', async () => {
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
  assert.deepEqual(reasoningChunks, [
    { kind: 'reasoning', text: 'think ' },
    { kind: 'reasoning', text: 'more' },
  ]);
  assert.deepEqual(visibleChunks, [
    { kind: 'reasoning', text: 'thinking' },
    { kind: 'text', text: 'answer' },
  ]);
});

test('OpenAI completeStream yields reasoning while the response stream remains open', async () => {
  const encoder = new TextEncoder();
  let sourceController;
  let sourceState = 'open';
  const response = new Response(
    new ReadableStream({
      start(controller) {
        sourceController = controller;
        controller.enqueue(
          encoder.encode('data: {"choices":[{"delta":{"reasoning_content":"think"}}]}\n'),
        );
      },
      cancel() {
        sourceState = 'cancelled';
      },
    }),
  );

  await withMockedFetch(
    async () => response,
    async () => {
      const iterator = new OpenAICompatibleProvider().completeStream(openAiParams())[Symbol.asyncIterator]();
      let timeout;
      const firstChunk = iterator.next();

      try {
        const result = await Promise.race([
          firstChunk,
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error('Reasoning was not yielded before the response stream closed')), 250);
          }),
        ]);
        assert.deepEqual(result, { done: false, value: { kind: 'reasoning', text: 'think' } });
        assert.equal(sourceState, 'open');

        sourceController.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"answer"}}]}\n'));
        assert.deepEqual(await iterator.next(), { done: false, value: { kind: 'text', text: 'answer' } });

        sourceController.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{"reasoning_content":" leaked"}}]}\ndata: [DONE]\n',
          ),
        );
        assert.deepEqual(await iterator.next(), { done: true, value: undefined });
      } finally {
        clearTimeout(timeout);
        if (sourceState === 'open') {
          sourceState = 'closed';
          sourceController.close();
        }
        await firstChunk.catch(() => {});
        await iterator.return?.().catch(() => {});
      }
    },
  );
});

test('OpenAI completeStream emits reasoning through an EOF-terminated stream', async () => {
  const provider = new OpenAICompatibleProvider();
  const chunks = await collectWithMockedFetch(
    provider,
    [
      'data: {"choices":[{"delta":{"reasoning_content":"think "}}]}\n',
      'data: {"choices":[{"delta":{"reasoning_content":"more"}}]}',
    ],
    openAiParams(),
  );
  assert.deepEqual(chunks, [
    { kind: 'reasoning', text: 'think ' },
    { kind: 'reasoning', text: 'more' },
  ]);
});

test('OpenAI completeStream preserves reasoning with an empty content delta', async () => {
  const provider = new OpenAICompatibleProvider();
  const chunks = await collectWithMockedFetch(
    provider,
    [
      'data: {"choices":[{"delta":{"content":"","reasoning_content":"thinking"}}]}\n',
      'data: {"choices":[{"delta":{"reasoning_content":" more"}}]}',
    ],
    openAiParams(),
  );
  assert.deepEqual(chunks, [
    { kind: 'reasoning', text: 'thinking' },
    { kind: 'reasoning', text: ' more' },
  ]);
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
  let malformedSent = false;
  let closeTimer;
  const response = new Response(
    new ReadableStream({
      start(stream) {
        stream.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"before"}}]}\n'));
      },
      pull(stream) {
        if (malformedSent) return;
        malformedSent = true;
        stream.enqueue(new TextEncoder().encode('data: {not valid JSON}\n'));
        closeTimer = setTimeout(() => {
          if (!cancelled) stream.close();
        }, 100);
      },
      cancel() {
        cancelled = true;
        if (closeTimer) clearTimeout(closeTimer);
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
