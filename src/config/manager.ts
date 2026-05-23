import Conf from "conf";
import type { Config, ProviderConfig, StyleProfile } from "./types.js";
import { configSchema } from "./schema.js";
import { ConfigError } from "../utils/errors.js";

function validateBaseUrl(name: string, url: string): void {
  try {
    new URL(url);
  } catch {
    throw new ConfigError(`Invalid baseUrl for ${name}: "${url}" is not a valid URL`);
  }
}

const defaults: Config = {
  initialized: false,
  provider: "openai",
  model: "gpt-4o-mini",
  conventionalCommits: true,
  maxSubjectLength: 72,
  styleProfile: null,
  providers: {},
};

const store = new Conf({
  projectName: "commit-echo",
  defaults,
});

export function getConfig(): Config {
  const raw = store.store;
  const result = configSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigError(
      `Invalid config: ${result.error.issues.map((i) => i.message).join("; ")}`
    );
  }
  return result.data;
}

export function updateConfig(partial: Partial<Config>): void {
  for (const [key, value] of Object.entries(partial)) {
    if (value !== undefined) {
      if (key === "providers") {
        const incoming = value as Record<string, ProviderConfig>;
        for (const [name, pc] of Object.entries(incoming)) {
          if (pc.baseUrl) validateBaseUrl(name, pc.baseUrl);
        }
        const existing = (store.get("providers") as Record<string, ProviderConfig>) ?? {};
        const merged: Record<string, ProviderConfig> = { ...existing };
        for (const [name, pc] of Object.entries(incoming)) {
          merged[name] = { ...existing[name], ...pc };
        }
        store.set("providers", merged as unknown);
        continue;
      }
      store.set(key as string, value as unknown);
    }
  }
}

export function getProviderConfig(name: string): ProviderConfig {
  return getConfig().providers[name] ?? {};
}

export function setProviderConfig(name: string, pc: ProviderConfig): void {
  if (pc.baseUrl) validateBaseUrl(name, pc.baseUrl);
  const providers = (store.get("providers") as Record<string, ProviderConfig>) ?? {};
  providers[name] = { ...providers[name], ...pc };
  store.set("providers", providers as unknown);
}

export function setStyleProfile(profile: StyleProfile): void {
  updateConfig({ styleProfile: profile });
}

export function clearConfig(): void {
  store.clear();
}

export function getApiKey(provider: string): string | null {
  const normalized = provider.toLowerCase();

  const echoVar = `ECHO_${normalized.toUpperCase()}_API_KEY`;
  const echoVal = process.env[echoVar];
  if (echoVal) return echoVal;

  const standardVar = `${normalized.toUpperCase()}_API_KEY`;
  const standardVal = process.env[standardVar];
  if (standardVal) return standardVal;

  const pc = getProviderConfig(normalized);
  return pc.apiKey ?? null;
}
