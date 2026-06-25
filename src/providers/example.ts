import type { ChatParams, ChatResult, Provider, ProviderStreamChunk } from '../types.js';

/**
 * A no-op/example provider for local testing and development.
 * Returns canned responses without requiring any external API keys.
 */
export class ExampleProvider implements Provider {
  async complete(params: ChatParams): Promise<ChatResult> {
    // Simulate a small delay to mimic network latency
    await new Promise((resolve) => setTimeout(resolve, 100));

    return {
      content: `chore: example commit message from ${params.model}\n\nThis is a canned response from the example provider.\nNo API key was required.`,
      model: params.model,
    };
  }

  async *completeStream(params: ChatParams): AsyncIterable<ProviderStreamChunk> {
    const text = `chore: example streamed commit from ${params.model}\n\nThis is a streamed canned response.`;
    
    yield { kind: 'model', model: params.model };
    
    // Simulate streaming by yielding characters in chunks
    const chunkSize = 5;
    for (let i = 0; i < text.length; i += chunkSize) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      yield { kind: 'text', text: text.slice(i, i + chunkSize) };
    }
  }

  async fetchModels(_baseUrl: string, _apiKey: string): Promise<string[]> {
    return ['example-model-1', 'example-model-2', 'example-model-3'];
  }
}
