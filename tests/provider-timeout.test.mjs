import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchWithTimeout } from '../dist/providers/request.js';

test('preserves the reason when the caller aborts a provider request', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const alreadyAborted of [false, true]) {
      const controller = new AbortController();
      const reason = new DOMException('Cancelled by caller', 'AbortError');
      if (alreadyAborted) controller.abort(reason);
      globalThis.fetch = async (_url, init) => {
        init.signal.throwIfAborted();
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
          controller.abort(reason);
        });
      };
      await assert.rejects(
        fetchWithTimeout('https://example.invalid/models', {}, 'Provider request', 1000, controller),
        (error) => error === reason
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('clears the provider timeout after response headers arrive', async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();

  globalThis.fetch = async (_url, init) => {
    assert.equal(init.signal, controller.signal);
    return new Response('ok');
  };

  try {
    await fetchWithTimeout('https://example.invalid/models', {}, 'Provider request', 10, controller);
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(controller.signal.aborted, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('aborts provider requests that exceed the timeout', async () => {
  const originalFetch = globalThis.fetch;
  let sawAbortSignal = false;

  globalThis.fetch = async (_url, init) => {
    sawAbortSignal = init?.signal instanceof AbortSignal;
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    });
  };

  try {
    await assert.rejects(
      fetchWithTimeout('https://example.invalid/models', {}, 'Provider request', 5),
      /Provider request timed out after 5ms/
    );
    assert.equal(sawAbortSignal, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
