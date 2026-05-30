import type { Config, Suggestion, StyleProfile, TruncationInfo } from '../types.js';
import { getProviderInfo } from '../providers/index.js';
import { complete } from '../providers/index.js';
import { resolveSystemPrompt, resolveUserPrompt, parseSuggestions, truncateDiff } from './prompt.js';
import { buildProfile, formatProfile } from '../history/store.js';
import { getBranchName } from '../git/diff.js';

function resolveApiKey(config: Config): string {
  if (config.apiKey) return config.apiKey;
  const info = getProviderInfo(config.provider);
  const envVar = info?.apiKeyEnv;
  if (envVar && process.env[envVar]) return process.env[envVar]!;
  return '';
}

export async function generateSuggestions(config: Config, diff: string, profileParam?: StyleProfile): Promise<{ suggestions: Suggestion[]; profile: StyleProfile; truncation?: TruncationInfo }> {
  const profile = profileParam ?? await buildProfile(config.historySize);

  // Truncate diff if it exceeds the configured limit
  const { diff: truncatedDiff, info: truncation } = truncateDiff(diff, config.maxDiffSize);

  const branch = getBranchName();
  const profileStr = formatProfile(profile);

  const vars = {
    diff: truncatedDiff,
    profile: profileStr,
    branch,
  };

  const systemPrompt = resolveSystemPrompt(profile, vars, config);
  const userPrompt = resolveUserPrompt(vars, config);

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
