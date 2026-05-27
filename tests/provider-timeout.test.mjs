import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchWithTimeout } from '../dist/providers/request.js';

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
