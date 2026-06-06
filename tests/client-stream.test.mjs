import assert from 'node:assert/strict';
import test from 'node:test';

import { generateSuggestionsStream } from '../dist/llm/client.js';

const emptyProfile = {
  avgLength: 0,
  commonPrefixes: [],
  prefixRates: {},
  imperativeRate: 0,
  sentenceCaseRate: 0,
  usesScopeRate: 0,
  usesBodyRate: 0,
  totalCommits: 0,
};

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

test('generateSuggestionsStream yields meta then text chunks', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(
      streamFromChunks([
        'data: {"choices":[{"delta":{"content":"1. feat: stream test"}}]}\n',
        'data: [DONE]\n',
      ]),
      { status: 200 },
    );

  try {
    const events = [];
    for await (const event of generateSuggestionsStream(
      {
        provider: '__custom__',
        model: 'test-model',
        baseUrl: 'http://127.0.0.1/v1',
        apiKey: 'test-key',
        historySize: 5,
        maxDiffSize: 100_000,
      },
      'diff --git a/file.txt b/file.txt\n',
      emptyProfile,
      'test-key',
    )) {
      events.push(event);
    }

    assert.equal(events[0]?.kind, 'meta');
    assert.equal(events[0]?.truncation, undefined);

    const chunks = events
      .filter((event) => event.kind === 'chunk')
      .map((event) => event.chunk);
    assert.equal(chunks.join(''), '1. feat: stream test');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('generateSuggestionsStream meta includes truncation info', async () => {
  const originalFetch = globalThis.fetch;
  const largeDiff = `diff --git a/big.txt b/big.txt\n${'x'.repeat(200)}`;

  globalThis.fetch = async () =>
    new Response(
      streamFromChunks(['data: [DONE]\n']),
      { status: 200 },
    );

  try {
    const events = [];
    for await (const event of generateSuggestionsStream(
      {
        provider: '__custom__',
        model: 'test-model',
        baseUrl: 'http://127.0.0.1/v1',
        apiKey: 'test-key',
        historySize: 5,
        maxDiffSize: 50,
      },
      largeDiff,
      emptyProfile,
      'test-key',
    )) {
      events.push(event);
    }

    assert.equal(events[0]?.kind, 'meta');
    assert.equal(events[0]?.truncation?.wasTruncated, true);
    assert.ok((events[0]?.truncation?.originalSize ?? 0) > 50);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
