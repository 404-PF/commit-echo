import type { ProviderStreamChunk } from '../types.js';

export type AnthropicSseState = {
  currentEvent: string;
};

export const SSE_STREAM_END = Symbol('SSE_STREAM_END');

export type SseLineParser = (
  line: string,
) => ProviderStreamChunk | (ProviderStreamChunk | typeof SSE_STREAM_END)[] | typeof SSE_STREAM_END | null;

/**
 * Read an SSE response body, split into lines, and yield parsed chunks.
 * Handles buffering for partial lines and ensures the reader is released
 * safely even after `reader.cancel()` has been called.
 */
export async function* streamSseResponse(
  response: Response,
  parseLine: SseLineParser,
  options: { controller?: AbortController; timeoutMs?: number; label?: string; maxLineLength?: number } = {},
): AsyncIterable<ProviderStreamChunk> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';
  let cancelled = false;
  let completed = false;

  try {
    while (true) {
      // The fetch deadline ends at the response headers. Bound each body read
      // separately so a slow but active SSE stream is not cut off mid-response.
      const read = reader.read();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline =
        options.timeoutMs === undefined
          ? undefined
          : new Promise<never>((_, reject) => {
              timer = setTimeout(() => {
                reject(new Error(`${options.label ?? 'Streaming request'} timed out after ${options.timeoutMs}ms`));
                options.controller?.abort();
              }, options.timeoutMs);
            });
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = deadline ? await Promise.race([read, deadline]) : await read;
      } finally {
        if (timer) clearTimeout(timer);
      }
      const { done, value } = result;

      if (value) {
        buffer += decoder.decode(value, { stream: !done });
      }

      const lines = buffer.split('\n');
      const maxLineLength = options.maxLineLength;
      if (maxLineLength !== undefined && lines.some((line) => line.length > maxLineLength)) {
        throw new Error(
          `${options.label ?? 'Streaming request'} exceeded the maximum SSE line length of ${maxLineLength} characters`,
        );
      }
      // When not done, the last element is an incomplete line — put it back.
      // When done, keep all elements so the final line is processed below.
      buffer = done ? '' : (lines.pop() ?? '');

      for (const line of lines) {
        const result = parseLine(line);
        if (result === SSE_STREAM_END) {
          await reader.cancel();
          cancelled = true;
          completed = true;
          return;
        }
        if (Array.isArray(result)) {
          for (const chunk of result) {
            if (chunk === SSE_STREAM_END) {
              await reader.cancel();
              cancelled = true;
              completed = true;
              return;
            }
            yield chunk;
          }
          continue;
        }
        if (result) yield result;
      }

      if (done) {
        completed = true;
        break;
      }
    }
  } finally {
    if (!completed) {
      options.controller?.abort();
      if (!cancelled) {
        try {
          await reader.cancel();
        } catch {
          // Preserve the parsing/read failure while still releasing the reader.
        }
      }
    }
    reader.releaseLock();
  }
}

export function parseOpenAiSseLine(line: string): {
  text?: string;
  reasoning?: string;
  model?: string;
  done?: boolean;
  error?: string;
} {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith('data:')) return {};

  const payload = trimmed.slice(5).trim();
  if (!payload) return {};

  if (payload === '[DONE]') return { done: true };

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error('Malformed OpenAI SSE data: invalid JSON');
  }

  if (!parsed || typeof parsed !== 'object') return {};

  const data = parsed as {
    error?: { message?: string };
    model?: string;
    choices?: { delta?: { content?: string; reasoning_content?: string } }[];
  };

  if (data.error?.message) {
    return { error: data.error.message };
  }

  const result: { text?: string; reasoning?: string; model?: string } = {};
  if (data.model) result.model = data.model;

  const delta = data.choices?.[0]?.delta;
  if (typeof delta?.content === 'string' && delta.content.length > 0) {
    result.text = delta.content;
  } else if (typeof delta?.reasoning_content === 'string') {
    result.reasoning = delta.reasoning_content;
  }

  return result;
}
/**
 * Parse a single Anthropic SSE line. Call repeatedly for each line in a batch,
 * passing shared `state` to track event types across event/data line pairs.
 */
export function parseAnthropicSseLine(
  line: string,
  state: AnthropicSseState,
): ProviderStreamChunk | typeof SSE_STREAM_END | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('event:')) {
    state.currentEvent = trimmed.slice(6).trim();
    return null;
  }

  if (!trimmed.startsWith('data:')) return null;

  const payload = trimmed.slice(5).trim();

  if (state.currentEvent === 'message_start') {
    try {
      const parsed = JSON.parse(payload) as {
        message?: { model?: string };
      };
      if (parsed.message?.model) {
        return { kind: 'model', model: parsed.message.model };
      }
    } catch {
      throw new Error('Malformed Anthropic SSE data: invalid JSON');
    }
    return null;
  }

  if (state.currentEvent === 'content_block_delta') {
    try {
      const parsed = JSON.parse(payload) as { delta?: { text?: string } };
      if (parsed.delta?.text) {
        return { kind: 'text', text: parsed.delta.text };
      }
    } catch {
      throw new Error('Malformed Anthropic SSE data: invalid JSON');
    }
    return null;
  }

  if (state.currentEvent === 'error') {
    let message = 'Anthropic streaming error';
    try {
      const parsed = JSON.parse(payload) as { error?: { message?: string } };
      if (parsed.error?.message) message = parsed.error.message;
    } catch {
      // Use default message
    }
    throw new Error(message);
  }

  if (state.currentEvent === 'message_stop') {
    return SSE_STREAM_END;
  }

  return null;
}
