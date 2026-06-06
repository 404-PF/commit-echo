import type { ChatParams, ChatResult, Provider } from '../types.js';
import { fetchWithTimeout } from './request.js';
import { parseAnthropicSseLines } from './sse.js';

export class AnthropicProvider implements Provider {
  async complete(params: ChatParams): Promise<ChatResult> {
    const { model, messages, temperature = 0.7, maxTokens = 1024, apiKey, baseUrl } = params;

    const url = `${baseUrl.replace(/\/+$/, '')}/messages`;

    const systemMessages = messages.filter((m) => m.role === 'system');
    const nonSystemMessages = messages.filter((m) => m.role !== 'system');

    const body: Record<string, unknown> = {
      model,
      messages: nonSystemMessages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      max_tokens: maxTokens,
      temperature,
    };

    if (systemMessages.length > 0) {
      body['system'] = systemMessages.map((m) => m.content).join('\n');
    }

    const response = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      },
      'Anthropic API request',
    );

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`Anthropic API error (${response.status}): ${errorBody || response.statusText}`);
    }

    const data = (await response.json()) as {
      content?: { type: string; text: string }[];
      model?: string;
    };

    const textContent = data.content?.find((c) => c.type === 'text');
    if (!textContent?.text) {
      throw new Error('Anthropic returned empty response.');
    }

    return {
      content: textContent.text.trim(),
      model: data.model ?? model,
    };
  }

  async *completeStream(params: ChatParams): AsyncIterable<string> {
    const { model, messages, temperature = 0.7, maxTokens = 1024, apiKey, baseUrl } = params;

    const url = `${baseUrl.replace(/\/+$/, '')}/messages`;

    const systemMessages = messages.filter((m) => m.role === 'system');
    const nonSystemMessages = messages.filter((m) => m.role !== 'system');

    const body: Record<string, unknown> = {
      model,
      messages: nonSystemMessages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      max_tokens: maxTokens,
      temperature,
      stream: true,
    };

    if (systemMessages.length > 0) {
      body['system'] = systemMessages.map((m) => m.content).join('\n');
    }

    const response = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      },
      'Anthropic streaming request',
    );

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`Anthropic API error (${response.status}): ${errorBody || response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';
    const sseState = { currentEvent: '' };

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (value) {
          buffer += decoder.decode(value, { stream: !done });
        }

        const lines = buffer.split('\n');
        buffer = done ? '' : (lines.pop() ?? '');

        const parser = parseAnthropicSseLines(lines, sseState);
        let result = parser.next();
        while (!result.done) {
          yield result.value;
          result = parser.next();
        }

        if (result.value) {
          await reader.cancel();
          return;
        }

        if (done) {
          if (buffer.trim()) {
            const tail = parseAnthropicSseLines([buffer], sseState);
            let tailResult = tail.next();
            while (!tailResult.done) {
              yield tailResult.value;
              tailResult = tail.next();
            }
            if (tailResult.value) {
              await reader.cancel();
              return;
            }
          }
          break;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async fetchModels(_baseUrl: string, _apiKey: string): Promise<string[]> {
    return [
      'claude-sonnet-4-20250514',
      'claude-sonnet-4',
      'claude-4-20250514',
      'claude-4',
      'claude-opus-4-20250514',
      'claude-opus-4',
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
      'claude-3-opus-20240229',
      'claude-3-sonnet-20240229',
      'claude-3-haiku-20240307',
    ];
  }
}
