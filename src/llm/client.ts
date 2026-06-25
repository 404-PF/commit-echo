import type {
  Config,
  Provider,
  Suggestion,
  StyleProfile,
  TruncationInfo,
} from "../types.js";
import { getProviderInfo } from "../providers/index.js";
import { complete, completeStream } from "../providers/index.js";
import {
  resolveSystemPrompt,
  resolveUserPrompt,
  parseSuggestions,
  truncateDiff,
} from "./prompt.js";
import { buildProfile, formatProfile } from "../history/store.js";
import { getBranchName, getLastCommitMessage } from "../git/diff.js";

function getApiKeyEnv(config: Config): string | undefined {
  if (config.provider === "__custom__") {
    return "CUSTOM_API_KEY";
  }

  return getProviderInfo(config.provider)?.apiKeyEnv;
}

export function resolveApiKey(config: Config): string {
  if (config.apiKey) return config.apiKey;
  const envVar = getApiKeyEnv(config);
  if (envVar && process.env[envVar]) return process.env[envVar]!;
  return "";
}

export function assertApiKeyAvailable(config: Config): string {
  const apiKey = resolveApiKey(config);
  const info = getProviderInfo(config.provider);
  const needsApiKey = config.provider === "__custom__" || info?.needsApiKey;

  if (!apiKey && needsApiKey) {
    const envVar = getApiKeyEnv(config) || "YOUR_PROVIDER_API_KEY";
    throw new Error(
      `No API key found. Run commit-echo init to set one, or export ${envVar}.`,
    );
  }

  return apiKey;
}

export async function generateSuggestions(
  config: Config,
  diff: string,
  profileParam?: StyleProfile,
  apiKeyParam?: string,
): Promise<{
  suggestions: Suggestion[];
  profile: StyleProfile;
  model: string;
  truncation?: TruncationInfo;
}> {
  const profile = profileParam ?? (await buildProfile(config.historySize));

  // Truncate diff if it exceeds the configured limit
  const { diff: truncatedDiff, info: truncation } = truncateDiff(
    diff,
    config.maxDiffSize,
  );

  const branch = getBranchName();
  const profileStr = formatProfile(profile);
  const message = getLastCommitMessage();

  const vars = {
    diff: truncatedDiff,
    profile: profileStr,
    branch,
    message,
  };

  const systemPrompt = resolveSystemPrompt(profile, vars, config);
  const userPrompt = resolveUserPrompt(vars, config);

  const apiKey = apiKeyParam ?? assertApiKeyAvailable(config);

  const result = await complete(config.provider, config.baseUrl, {
    model: config.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
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
    throw new Error(
      "Could not parse any suggestions from LLM response. The model may need a different prompt format.",
    );
  }

  return {
    suggestions,
    profile,
    model: result.model,
    truncation: truncation.wasTruncated ? truncation : undefined,
  };
}

export type SuggestionStreamEvent =
  | { kind: "meta"; truncation?: TruncationInfo }
  | { kind: "model"; model: string }
  | { kind: "text"; text: string };

/**
 * Stream commit suggestions from the LLM provider.
 * Yields a meta event first (including truncation info), then text chunks.
 * After iteration completes, the caller can parse accumulated text with
 * `parseSuggestions()`.
 */
export async function* generateSuggestionsStream(
  config: Config,
  diff: string,
  profileParam?: StyleProfile,
  apiKeyParam?: string,
  provider?: Provider,
): AsyncGenerator<SuggestionStreamEvent> {
  const profile = profileParam ?? (await buildProfile(config.historySize));

  const { diff: truncatedDiff, info: truncation } = truncateDiff(
    diff,
    config.maxDiffSize,
  );

  const branch = getBranchName();
  const profileStr = formatProfile(profile);
  const message = getLastCommitMessage();

  const vars = {
    diff: truncatedDiff,
    profile: profileStr,
    branch,
    message,
  };

  const systemPrompt = resolveSystemPrompt(profile, vars, config);
  const userPrompt = resolveUserPrompt(vars, config);

  const apiKey = apiKeyParam ?? assertApiKeyAvailable(config);

  yield {
    kind: "meta",
    truncation: truncation.wasTruncated ? truncation : undefined,
  };

  const stream = completeStream(
    config.provider,
    config.baseUrl,
    {
      model: config.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
      maxTokens: 1024,
      apiKey,
    },
    provider,
  );

  for await (const chunk of stream) {
    if (chunk.kind === "model") {
      yield { kind: "model", model: chunk.model };
      continue;
    }
    yield { kind: "text", text: chunk.text };
  }
}

export async function testConnection(config: Config): Promise<string> {
  const apiKey = assertApiKeyAvailable(config);

  const result = await complete(config.provider, config.baseUrl, {
    model: config.model,
    messages: [{ role: "user", content: 'Reply with exactly the word "ok".' }],
    temperature: 0,
    maxTokens: 10,
    apiKey,
  });

  return result.model;
}
