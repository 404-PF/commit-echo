import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseAnthropicSseLines,
  parseOpenAiSseLine,
} from '../dist/providers/sse.js';
import { AnthropicProvider } from '../dist/providers/anthropic.js';
import { OpenAICompatibleProvider } from '../dist/providers/openai-compatible.js';

function streamFromChunks(chunks) {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(new TextEncoder().encode(chunks[index]));
      index += 1;
    },
  });
}

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

test('parseOpenAiSseLine detects stream completion', () => {
  assert.deepEqual(parseOpenAiSseLine('data: [DONE]'), { done: true });
});

test('parseOpenAiSseLine surfaces API errors', () => {
  const result = parseOpenAiSseLine(
    'data: {"error":{"message":"rate limited"}}',
  );

  assert.equal(result.error, 'rate limited');
});

test('parseAnthropicSseLines handles event and data split across line batches', () => {
  const state = { currentEvent: '' };

  const first = parseAnthropicSseLines(['event: content_block_delta'], state);
  let result = first.next();
  assert.equal(result.done, true);
  assert.equal(result.value, false);

  const second = parseAnthropicSseLines(
    ['data: {"delta":{"text":"hello"}}'],
    state,
  );
  result = second.next();
  assert.deepEqual(result.value, { kind: 'text', text: 'hello' });
  result = second.next();
  assert.equal(result.done, true);
  assert.equal(result.value, false);
});

test('parseAnthropicSseLines extracts model from message_start', () => {
  const state = { currentEvent: '' };
  const parser = parseAnthropicSseLines(
    [
      'event: message_start',
      'data: {"type":"message_start","message":{"model":"claude-sonnet-4"}}',
    ],
    state,
  );

  const result = parser.next();
  assert.deepEqual(result.value, { kind: 'model', model: 'claude-sonnet-4' });
});

test('parseAnthropicSseLines stops on message_stop', () => {
  const state = { currentEvent: '' };
  const parser = parseAnthropicSseLines(
    ['event: message_stop', 'data: {}'],
    state,
  );

  const result = parser.next();
  assert.equal(result.done, true);
  assert.equal(result.value, true);
});

test('parseAnthropicSseLines throws on error events', () => {
  const state = { currentEvent: '' };
  const parser = parseAnthropicSseLines(
    ['event: error', 'data: {"error":{"message":"overloaded"}}'],
    state,
  );

  assert.throws(() => parser.next(), /overloaded/);
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
