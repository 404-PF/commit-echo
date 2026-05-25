import type { Provider, ChatParams, ChatResult } from '../types.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import { AnthropicProvider } from './anthropic.js';
import { CohereProvider } from './cohere.js';
import { getProviderInfo } from './registry.js';

export { BUILTIN_PROVIDERS, getProviderInfo, getProviderNames } from './registry.js';

const CUSTOM_PROVIDER_KEY = '__custom__';

function getBaseUrl(configProvider: string, baseUrlOverride?: string): string {
  if (baseUrlOverride) return baseUrlOverride;
  const info = getProviderInfo(configProvider);
  return info?.baseUrl ?? '';
}

function resolveApiKey(configApiKey?: string): string {
  if (configApiKey) return configApiKey;
  const info = getProviderInfo(CUSTOM_PROVIDER_KEY);
  return '';
}

export function createProvider(configProvider: string): Provider {
  if (configProvider === 'anthropic') return new AnthropicProvider();
  if (configProvider === 'cohere') return new CohereProvider();
  return new OpenAICompatibleProvider();
}

export async function complete(configProvider: string, baseUrlOverride: string | undefined, params: Omit<ChatParams, 'baseUrl'>): Promise<ChatResult> {
  const provider = createProvider(configProvider);
  const baseUrl = getBaseUrl(configProvider, baseUrlOverride);
  return provider.complete({ ...params, baseUrl });
}

export async function fetchModels(configProvider: string, baseUrlOverride: string | undefined, apiKey: string): Promise<string[]> {
  const provider = createProvider(configProvider);

  const info = getProviderInfo(configProvider);
  const baseUrl = baseUrlOverride ?? info?.baseUrl ?? '';

  return provider.fetchModels(baseUrl, apiKey);
}
