import type { Config, Suggestion, StyleProfile } from '../types.js';
import { getProviderInfo } from '../providers/index.js';
import { complete } from '../providers/index.js';
import { buildSystemPrompt, buildUserPrompt, parseSuggestions } from './prompt.js';
import { buildProfile } from '../history/store.js';

function resolveApiKey(config: Config): string {
  if (config.apiKey) return config.apiKey;
  const info = getProviderInfo(config.provider);
  const envVar = info?.apiKeyEnv;
  if (envVar && process.env[envVar]) return process.env[envVar]!;
  return '';
}

export async function generateSuggestions(config: Config, diff: string): Promise<{ suggestions: Suggestion[]; profile: StyleProfile }> {
  const profile = await buildProfile(config.historySize);
  const systemPrompt = buildSystemPrompt(profile);
  const userPrompt = buildUserPrompt(diff);

  const apiKey = resolveApiKey(config);

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

  return { suggestions, profile };
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
