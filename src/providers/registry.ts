import type { LLMProvider } from "./types.js";
import { OpenAICompatible } from "./openai-compatible.js";
import { AnthropicProvider } from "./anthropic.js";
import { GeminiProvider } from "./gemini.js";
import { OllamaProvider } from "./ollama.js";
import { MistralProvider } from "./mistral.js";
import { CohereProvider } from "./cohere.js";

const registry = new Map<string, LLMProvider>();

function register(provider: LLMProvider): void {
  registry.set(provider.name, provider);
}

register(new OpenAICompatible("openai", "OpenAI", ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"], "https://api.openai.com/v1"));
register(new OpenAICompatible("openrouter", "OpenRouter", ["openai/gpt-4o", "openai/gpt-4o-mini", "anthropic/claude-3.5-sonnet", "google/gemini-2.0-flash"], "https://openrouter.ai/api/v1"));
register(new OpenAICompatible("groq", "Groq", ["llama3-70b-8192", "llama3-8b-8192", "mixtral-8x7b-32768"], "https://api.groq.com/openai/v1"));
register(new OpenAICompatible("together", "Together AI", ["mistralai/Mixtral-8x22B-Instruct-v0.1", "meta-llama/Llama-3-70b-chat-hf"], "https://api.together.xyz/v1"));
register(new OpenAICompatible("deepseek", "DeepSeek", ["deepseek-chat", "deepseek-reasoner"], "https://api.deepseek.com"));
register(new AnthropicProvider());
register(new GeminiProvider());
register(new OllamaProvider());
register(new MistralProvider());
register(new CohereProvider());

export function getProvider(name: string): LLMProvider {
  const provider = registry.get(name);
  if (!provider) {
    const available = [...registry.keys()].join(", ");
    throw new Error(`Unknown provider "${name}". Available: ${available}`);
  }
  return provider;
}

export function listProviders(): LLMProvider[] {
  return [...registry.values()];
}

