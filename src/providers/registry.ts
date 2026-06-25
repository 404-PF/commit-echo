import type { ProviderInfo } from '../types.js';

export const BUILTIN_PROVIDERS: ProviderInfo[] = [
  {
    key: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    website: 'https://openai.com',
    docsUrl: 'https://platform.openai.com/docs',
    needsApiKey: true,
  },
  {
    key: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    website: 'https://anthropic.com',
    docsUrl: 'https://docs.anthropic.com',
    needsApiKey: true,
  },
  {
    key: 'google',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKeyEnv: 'GOOGLE_API_KEY',
    website: 'https://ai.google.dev',
    docsUrl: 'https://ai.google.dev/gemini-api/docs',
    needsApiKey: true,
  },
  {
    key: 'mistral',
    name: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    apiKeyEnv: 'MISTRAL_API_KEY',
    website: 'https://mistral.ai',
    docsUrl: 'https://docs.mistral.ai',
    needsApiKey: true,
  },
  {
    key: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKeyEnv: 'GROQ_API_KEY',
    website: 'https://groq.com',
    docsUrl: 'https://console.groq.com/docs',
    needsApiKey: true,
  },
  {
    key: 'cohere',
    name: 'Cohere',
    baseUrl: 'https://api.cohere.com/v1',
    apiKeyEnv: 'COHERE_API_KEY',
    website: 'https://cohere.com',
    docsUrl: 'https://docs.cohere.com',
    needsApiKey: true,
  },
  {
    key: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    website: 'https://deepseek.com',
    docsUrl: 'https://platform.deepseek.com/docs',
    needsApiKey: true,
  },
  {
    key: 'ollama',
    name: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    apiKeyEnv: 'OLLAMA_API_KEY',
    website: 'https://ollama.ai',
    docsUrl: 'https://github.com/ollama/ollama',
    needsApiKey: false,
  },
  {
    key: 'together',
    name: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1',
    apiKeyEnv: 'TOGETHER_API_KEY',
    website: 'https://together.ai',
    docsUrl: 'https://docs.together.ai',
    needsApiKey: true,
  },
  {
    key: 'fireworks',
    name: 'Fireworks AI',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    apiKeyEnv: 'FIREWORKS_API_KEY',
    website: 'https://fireworks.ai',
    docsUrl: 'https://docs.fireworks.ai',
    needsApiKey: true,
  },
  {
    key: 'example',
    name: 'Example (no API key)',
    baseUrl: '',
    apiKeyEnv: '',
    website: '',
    docsUrl: '',
    needsApiKey: false,
  },
];

export function getProviderInfo(key: string): ProviderInfo | undefined {
  return BUILTIN_PROVIDERS.find((p) => p.key === key);
}

export function getProviderNames(): string[] {
  return BUILTIN_PROVIDERS.map((p) => p.name);
}
