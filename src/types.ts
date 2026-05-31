export interface Config {
  provider: string;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  historySize: number;
  maxDiffSize: number;
  systemPromptTemplate?: string;
  userPromptTemplate?: string;
}

export interface TruncationInfo {
  wasTruncated: boolean;
  originalSize: number;
  truncatedSize: number;
  filesTruncated: number;
}

export interface CommitEntry {
  timestamp: string;
  message: string;
  diff: string;
  model: string;
  provider: string;
}

export interface StyleProfile {
  avgLength: number;
  commonPrefixes: string[];
  prefixRates: Record<string, number>;
  imperativeRate: number;
  sentenceCaseRate: number;
  usesScopeRate: number;
  usesBodyRate: number;
  totalCommits: number;
}

export interface Suggestion {
  index: number;
  message: string;
  body?: string;
}

export interface ProviderInfo {
  key: string;
  name: string;
  baseUrl: string;
  apiKeyEnv: string;
  website: string;
  docsUrl: string;
  needsApiKey: boolean;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatParams {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  apiKey: string;
  baseUrl: string;
}

export interface ChatResult {
  content: string;
  model: string;
}

export interface Provider {
  complete(params: ChatParams): Promise<ChatResult>;
  fetchModels(baseUrl: string, apiKey: string): Promise<string[]>;
}
