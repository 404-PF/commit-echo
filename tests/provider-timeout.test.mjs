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

test('clears the provider timeout after the response body is consumed', async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();

  globalThis.fetch = async (_url, init) => {
    assert.equal(init.signal, controller.signal);
    return new Response('ok');
  };

  try {
    const response = await fetchWithTimeout(
      'https://example.invalid/models',
      {},
      'Provider request',
      10,
      controller,
    );
    assert.equal(await response.text(), 'ok');
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

test('times out and aborts a response body that stalls after headers', async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  let sawAbort = false;

  globalThis.fetch = async (_url, init) => {
    init.signal.addEventListener('abort', () => {
      sawAbort = true;
    }, { once: true });

    const body = new ReadableStream({
      pull() {
        if (init.signal.aborted) {
          return Promise.reject(init.signal.reason);
        }

        return new Promise((_resolve, reject) => {
          const fallback = setTimeout(() => {
            reject(new Error('stalled body mock did not observe the abort signal'));
          }, 1000);
          init.signal.addEventListener(
            'abort',
            () => {
              clearTimeout(fallback);
              reject(init.signal.reason);
            },
            { once: true },
          );
        });
      },
    });

    return new Response(body);
  };

  try {
    const response = await fetchWithTimeout(
      'https://example.invalid/models',
      {},
      'Provider request',
      5,
      controller,
    );
    await assert.rejects(response.text(), /Provider request timed out after 5ms/);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(sawAbort, true);
});


test('preserves external cancellation after response headers for streaming requests', async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  const externalController = new AbortController();
  const reason = new DOMException('Cancelled by caller', 'AbortError');
  let sawInternalAbort = false;

  globalThis.fetch = async (_url, init) => {
    init.signal.addEventListener(
      'abort',
      () => {
        sawInternalAbort = true;
      },
      { once: true },
    );

    const body = new ReadableStream({
      pull() {
        if (init.signal.aborted) {
          return Promise.reject(init.signal.reason);
        }

        return new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
        });
      },
    });

    return new Response(body);
  };

  try {
    const response = await fetchWithTimeout(
      'https://example.invalid/stream',
      {},
      'Provider streaming request',
      1000,
      controller,
      externalController.signal,
      false,
    );
    const bodyPromise = response.text();
    externalController.abort(reason);

    await assert.rejects(bodyPromise, (error) => error === reason);
    assert.equal(sawInternalAbort, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
