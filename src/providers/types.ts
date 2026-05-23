import type { StyleProfile } from "../config/types.js";

export interface ProviderConfigInput {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export interface GenerateContext {
  diff: string;
  diffStat: string;
  branch: string;
  changedFiles: string[];
  styleProfile: StyleProfile | null;
  conventionalCommits: boolean;
  maxSubjectLength: number;
}

export interface LLMProvider {
  readonly name: string;
  readonly displayName: string;
  readonly models: string[];
  readonly requiresApiKey: boolean;

  configure(input: ProviderConfigInput): void;
  generate(context: GenerateContext): Promise<string>;
}
