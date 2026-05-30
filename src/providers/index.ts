import type { Provider, ChatParams, ChatResult } from '../types.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import { AnthropicProvider } from './anthropic.js';
import { CohereProvider } from './cohere.js';
import { BUILTIN_PROVIDERS, getProviderInfo } from './registry.js';

export { BUILTIN_PROVIDERS, getProviderInfo, getProviderNames } from './registry.js';

const CUSTOM_PROVIDER_KEY = '__custom__';

function getValidProviderKeys(): string {
  return [...BUILTIN_PROVIDERS.map((provider) => provider.key), CUSTOM_PROVIDER_KEY].join(', ');
}

function assertKnownProvider(configProvider: string): void {
  if (configProvider === CUSTOM_PROVIDER_KEY) {
    return;
  }

  if (!getProviderInfo(configProvider)) {
    throw new Error(`Unknown provider: '${configProvider}'. Valid providers: ${getValidProviderKeys()}`);
  }
}

function getBaseUrl(configProvider: string, baseUrlOverride?: string): string {
  assertKnownProvider(configProvider);
  if (baseUrlOverride) return baseUrlOverride;
  if (configProvider === CUSTOM_PROVIDER_KEY) {
    throw new Error('Custom provider requires a base URL.');
  }

  const info = getProviderInfo(configProvider);
  return info!.baseUrl;
}
export function createProvider(configProvider: string): Provider {
  assertKnownProvider(configProvider);
  if (configProvider === 'anthropic') return new AnthropicProvider();
  if (configProvider === 'cohere') return new CohereProvider();
  return new OpenAICompatibleProvider();
}

export async function complete(
  configProvider: string,
  baseUrlOverride: string | undefined,
  params: Omit<ChatParams, 'baseUrl'>,
): Promise<ChatResult> {
  const provider = createProvider(configProvider);
  const baseUrl = getBaseUrl(configProvider, baseUrlOverride);
  return provider.complete({ ...params, baseUrl });
}

export async function fetchModels(
  configProvider: string,
  baseUrlOverride: string | undefined,
  apiKey: string,
): Promise<string[]> {
  const provider = createProvider(configProvider);
  const baseUrl = getBaseUrl(configProvider, baseUrlOverride);

  return provider.fetchModels(baseUrl, apiKey);
}
