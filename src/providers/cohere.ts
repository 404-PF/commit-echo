import type { ChatParams, ChatResult, Provider } from '../types.js';
import { fetchWithTimeout } from './request.js';

export class CohereProvider implements Provider {
  async complete(params: ChatParams): Promise<ChatResult> {
    const { model, messages, temperature = 0.7, maxTokens = 1024, apiKey, baseUrl } = params;

    const url = `${baseUrl.replace(/\/+$/, '')}/chat`;

    const systemMessages = messages.filter((m) => m.role === 'system');
    const nonSystemMessages = messages.filter((m) => m.role !== 'system');

    const chatHistory = nonSystemMessages.slice(0, -1).map((m) => ({
      role: m.role === 'user' ? 'USER' : 'CHATBOT',
      message: m.content,
    }));

    const lastMessage = nonSystemMessages.at(-1);

    const body: Record<string, unknown> = {
      model,
      message: lastMessage?.content ?? '',
      chat_history: chatHistory,
      temperature,
      max_tokens: maxTokens,
    };

    if (systemMessages.length > 0) {
      body['preamble'] = systemMessages.map((m) => m.content).join('\n');
    }

    const response = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      },
      'Cohere API request',
    );

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`Cohere API error (${response.status}): ${errorBody || response.statusText}`);
    }

    const data = (await response.json()) as {
      text?: string;
      meta?: { api_version?: { version?: string } };
    };

    if (!data.text) {
      throw new Error('Cohere returned empty response.');
    }

    return {
      content: data.text.trim(),
      model,
    };
  }

  async fetchModels(baseUrl: string, apiKey: string): Promise<string[]> {
    const url = `${baseUrl.replace(/\/+$/, '')}/models`;

    const response = await fetchWithTimeout(
      url,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      },
      'Cohere model request',
    );

    if (!response.ok) {
      return ['command-r-plus', 'command-r', 'command-xlarge', 'command-large'];
    }

    const data = (await response.json()) as {
      models?: { name?: string; id?: string }[];
    };

    if (data.models && Array.isArray(data.models)) {
      return data.models
        .map((m) => m.name ?? m.id ?? '')
        .filter(Boolean)
        .sort();
    }

    return ['command-r-plus', 'command-r', 'command-xlarge', 'command-large'];
  }
}
