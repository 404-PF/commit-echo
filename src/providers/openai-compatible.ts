import type { ChatParams, ChatResult, Provider } from '../types.js';

export class OpenAICompatibleProvider implements Provider {
  async complete(params: ChatParams): Promise<ChatResult> {
    const { model, messages, temperature = 0.7, maxTokens = 1024, apiKey, baseUrl } = params;

    const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(
        `OpenAI-compatible API error (${response.status}): ${errorBody || response.statusText}`
      );
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

  async fetchModels(baseUrl: string, apiKey: string): Promise<string[]> {
    const url = `${baseUrl.replace(/\/+$/, '')}/models`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(url, { headers });

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
