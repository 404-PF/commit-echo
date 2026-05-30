import type { Config, Suggestion, StyleProfile, TruncationInfo } from '../types.js';
import { getProviderInfo } from '../providers/index.js';
import { complete } from '../providers/index.js';
import { buildSystemPrompt, buildUserPrompt, parseSuggestions, truncateDiff } from './prompt.js';
import { buildProfile } from '../history/store.js';

export function resolveApiKey(config: Config): string {
  if (config.apiKey) return config.apiKey;
  const info = getProviderInfo(config.provider);
  const envVar = info?.apiKeyEnv;
  if (envVar && process.env[envVar]) return process.env[envVar]!;
  return '';
}

export function assertApiKeyAvailable(config: Config): string {
  const apiKey = resolveApiKey(config);
  const info = getProviderInfo(config.provider);

  if (!apiKey && info?.needsApiKey) {
    const envVar = info.apiKeyEnv || 'YOUR_PROVIDER_API_KEY';
    throw new Error(`No API key found. Run commit-echo init to set one, or export ${envVar}.`);
  }

  return apiKey;
}

export async function generateSuggestions(config: Config, diff: string, profileParam?: StyleProfile, apiKeyParam?: string): Promise<{ suggestions: Suggestion[]; profile: StyleProfile; truncation?: TruncationInfo }> {
  const profile = profileParam ?? await buildProfile(config.historySize);

  // Truncate diff if it exceeds the configured limit
  const { diff: truncatedDiff, info: truncation } = truncateDiff(diff, config.maxDiffSize);

  const systemPrompt = buildSystemPrompt(profile);
  const userPrompt = buildUserPrompt(truncatedDiff);

  const apiKey = apiKeyParam ?? assertApiKeyAvailable(config);

  const result = await complete(config.provider, config.baseUrl, {
    model: config.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.7,
    maxTokens: 1024,
    apiKey,
  });

  const parsed = parseSuggestions(result.content);

  const suggestions: Suggestion[] = parsed.map((p, i) => ({
    index: i + 1,
    message: p.message,
    body: p.body,
  }));

  if (suggestions.length === 0) {
    throw new Error('Could not parse any suggestions from LLM response. The model may need a different prompt format.');
  }

  return {
    suggestions,
    profile,
    truncation: truncation.wasTruncated ? truncation : undefined,
  };
}

export async function testConnection(config: Config): Promise<string> {
  const apiKey = resolveApiKey(config);

  const result = await complete(config.provider, config.baseUrl, {
    model: config.model,
    messages: [
      { role: 'user', content: 'Reply with exactly the word "ok".' },
    ],
    temperature: 0,
    maxTokens: 10,
    apiKey,
  });

  return result.model;
}
