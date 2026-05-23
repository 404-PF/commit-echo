export interface ProviderConfig {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

export interface StyleProfile {
  dominantPrefix: string;
  prefixPct: number;
  usesScope: boolean;
  scopePct: number;
  avgSubjectLength: number;
  tone: "imperative" | "descriptive" | "mixed";
  usesBody: boolean;
  bodyPct: number;
  examples: string[];
  analyzedAt: string;
  totalCommits: number;
}

export interface Config {
  initialized: boolean;
  provider: string;
  model: string;
  conventionalCommits: boolean;
  maxSubjectLength: number;
  styleProfile: StyleProfile | null;
  providers: Record<string, ProviderConfig>;
}
