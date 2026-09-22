export const DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS = 30_000;

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  label: string,
  timeoutMs = DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS,
  controller = new AbortController(),
  externalSignal?: AbortSignal,
  keepTimeoutThroughBody = true,
): Promise<Response> {
  let timedOut = false;
  let timeoutError: Error | undefined;
  let externalAbortListener: (() => void) | undefined;

  if (externalSignal) {
    const abortFromExternal = () => {
      controller.abort(externalSignal.reason);
    };
    if (externalSignal.aborted) {
      abortFromExternal();
    } else {
      externalAbortListener = abortFromExternal;
      externalSignal.addEventListener('abort', abortFromExternal, { once: true });
    }
  }

  let timeout: ReturnType<typeof setTimeout>;

  const cleanup = () => {
    clearTimeout(timeout);
    if (externalSignal && externalAbortListener) {
      externalSignal.removeEventListener('abort', externalAbortListener);
      externalAbortListener = undefined;
    }
  };

  timeout = setTimeout(() => {
    timedOut = true;
    timeoutError = new Error(`${label} timed out after ${timeoutMs}ms`);
    controller.abort(timeoutError);
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });

    if (!keepTimeoutThroughBody || !response.body) {
      cleanup();
      return response;
    }

    const reader = response.body.getReader();
    const wrappedBody = new ReadableStream<Uint8Array>({
      async pull(streamController) {
        try {
          const result = await reader.read();
          if (result.done) {
            cleanup();
            streamController.close();
            return;
          }
          streamController.enqueue(result.value);
        } catch (error) {
          cleanup();
          streamController.error(timedOut ? timeoutError : error);
        }
      },
      async cancel(reason) {
        cleanup();
        await reader.cancel(reason).catch(() => {});
      },
    });

    return new Response(wrappedBody, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (error) {
    cleanup();
    if (timedOut) {
      throw timeoutError;
    }
    throw error;
  }
}
