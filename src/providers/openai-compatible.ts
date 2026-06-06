import type { ChatParams, ChatResult, Provider, ProviderStreamChunk } from '../types.js';
import { fetchWithTimeout } from './request.js';
import { parseOpenAiSseLine, streamSseResponse, SSE_STREAM_END } from './sse.js';

function buildOpenAiRequestBody(
  params: ChatParams,
  options: { stream?: boolean } = {},
): Record<string, unknown> {
  const { model, messages, temperature = 0.7, maxTokens = 1024 } = params;

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  };

  if (options.stream) {
    body.stream = true;
  }

  return body;
}

export class OpenAICompatibleProvider implements Provider {
  async complete(params: ChatParams): Promise<ChatResult> {
    const { model, apiKey, baseUrl } = params;

    const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

    const response = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(buildOpenAiRequestBody(params)),
      },
      'OpenAI-compatible API request',
    );

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`OpenAI-compatible API error (${response.status}): ${errorBody || response.statusText}`);
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
      model?: string;
    };

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('LLM returned empty response. The model may be unavailable or overloaded.');
    }

    return {
      content: content.trim(),
      model: data.model ?? model,
    };
  }

  async *completeStream(params: ChatParams): AsyncIterable<ProviderStreamChunk> {
    const { apiKey, baseUrl } = params;

    const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

    const response = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(buildOpenAiRequestBody(params, { stream: true })),
      },
      'OpenAI-compatible streaming request',
    );

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`OpenAI-compatible API error (${response.status}): ${errorBody || response.statusText}`);
    }

    yield* streamSseResponse(response, (line) => {
      const parsed = parseOpenAiSseLine(line);
      if (parsed.error) throw new Error(`OpenAI-compatible streaming error: ${parsed.error}`);
      if (parsed.done) return SSE_STREAM_END;
      if (parsed.model) return { kind: 'model', model: parsed.model };
      if (parsed.text) return { kind: 'text', text: parsed.text };
      return null;
    });
  }

  async fetchModels(baseUrl: string, apiKey: string): Promise<string[]> {
    const url = `${baseUrl.replace(/\/+$/, '')}/models`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetchWithTimeout(url, { headers }, 'OpenAI-compatible model request');

    if (!response.ok) {
      throw new Error(`Failed to fetch models (${response.status}): ${response.statusText}`);
    }

    const data = (await response.json()) as {
      data?: { id: string; object?: string }[];
    };

    if (!data.data || !Array.isArray(data.data)) {
      throw new Error('Unexpected response format when fetching models');
    }

    return data.data
      .filter((m) => !m.object || m.object === 'model')
      .map((m) => m.id)
      .filter((id) => !id.startsWith('ft:'))
      .sort();
  }
}
