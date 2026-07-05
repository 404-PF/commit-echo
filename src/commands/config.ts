import { intro, outro } from '@clack/prompts';
import pc from 'picocolors';
import {
  configExists,
  DEFAULT_HISTORY_SIZE,
  DEFAULT_MAX_DIFF_SIZE,
  loadConfig,
  loadRawConfig,
  saveConfig,
} from '../config/store.js';
import { getProviderInfo } from '../providers/index.js';
import type { Config } from '../types.js';

const CUSTOM_PROVIDER_KEY = '__custom__';

type ConfigCommandOptions = {
  json?: boolean;
};

type ConfigJsonOutput = {
  provider: string;
  model: string;
  endpoint: string;
  historySize: number;
  maxDiffSize: number;
  apiKey: string;
};

const CONFIG_SET_KEYS = [
  'provider',
  'model',
  'baseUrl',
  'apiKey',
  'historySize',
  'maxDiffSize',
  'systemPromptTemplate',
  'userPromptTemplate',
] as const;

type ConfigSetKey = (typeof CONFIG_SET_KEYS)[number];
type ConfigSetValueMap = Pick<Config, ConfigSetKey>;

const NUMERIC_CONFIG_KEYS = new Set<ConfigSetKey>(['historySize', 'maxDiffSize']);

function isConfigSetKey(key: string): key is ConfigSetKey {
  return CONFIG_SET_KEYS.includes(key as ConfigSetKey);
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function parseConfigSetValue<K extends ConfigSetKey>(key: K, rawValue: string): ConfigSetValueMap[K] {
  if (key === 'provider') {
    if (rawValue !== CUSTOM_PROVIDER_KEY && !getProviderInfo(rawValue)) {
      throw new Error(`Unknown provider: ${rawValue}.`);
    }
    return rawValue as ConfigSetValueMap[K];
  }

  if (key === 'baseUrl') {
    if (!rawValue) {
      return undefined as ConfigSetValueMap[K];
    }

    try {
      const url = new URL(rawValue);
      return normalizeBaseUrl(url.toString()) as ConfigSetValueMap[K];
    } catch {
      throw new Error('baseUrl must be a valid URL.');
    }
  }

  if (!NUMERIC_CONFIG_KEYS.has(key)) {
    return rawValue as ConfigSetValueMap[K];
  }

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${key} must be a positive integer.`);
  }

  return value as ConfigSetValueMap[K];
}

function updateConfigField<K extends ConfigSetKey>(
  config: Config,
  key: K,
  value: ConfigSetValueMap[K],
): Config {
  return {
    ...config,
    [key]: value,
  };
}

/** Masks a stored API key while leaving enough prefix to identify which key is configured. */
export function maskApiKey(apiKey: string | undefined): string {
  if (!apiKey) {
    return 'not stored in config';
  }

  const visibleLength = Math.min(4, Math.max(2, apiKey.length));
  return `${apiKey.slice(0, visibleLength)}••••`;
}

/** Returns the saved custom endpoint or the built-in provider endpoint. */
function resolveEndpoint(config: Config): string {
  return config.baseUrl ?? getProviderInfo(config.provider)?.baseUrl ?? 'not configured';
}

/** Converts provider keys into user-facing provider labels for the CLI output. */
function formatProvider(config: Config): string {
  if (config.provider === CUSTOM_PROVIDER_KEY) {
    return 'Custom (OpenAI-compatible)';
  }

  return getProviderInfo(config.provider)?.name ?? config.provider;
}

/** Build the script-friendly payload used by `commit-echo config --json`. */
function getConfigJsonOutput(config: Config): ConfigJsonOutput {
  return {
    provider: formatProvider(config),
    model: config.model || 'not configured',
    endpoint: resolveEndpoint(config),
    historySize: config.historySize,
    maxDiffSize: config.maxDiffSize,
    apiKey: maskApiKey(config.apiKey),
  };
}

/** Displays the current commit-echo configuration without exposing secret values. */
export async function configCommand(options: ConfigCommandOptions = {}): Promise<void> {
  if (!configExists()) {
    if (options.json) {
      console.log(JSON.stringify({ error: 'No configuration found. Run commit-echo init first.' }, null, 2));
      process.exit(1);
    }
    intro(pc.bold(pc.cyan('commit-echo config')));
    outro(pc.yellow('No configuration found. Run `commit-echo init` first.'));
    return;
  }

  const config = await loadConfig();

  if (options.json) {
    console.log(JSON.stringify(getConfigJsonOutput(config), null, 2));
    return;
  }

  intro(pc.bold(pc.cyan('commit-echo config')));

  console.log(pc.bold('\nCurrent Configuration\n'));
  console.log(`  Provider: ${pc.cyan(formatProvider(config))}`);
  console.log(`  Model: ${pc.cyan(config.model || 'not configured')}`);
  console.log(`  Endpoint: ${pc.dim(resolveEndpoint(config))}`);
  console.log(`  History size: ${pc.bold(String(config.historySize))}`);
  console.log(`  Max diff size: ${pc.bold(String(config.maxDiffSize))}`);
  console.log(`  API key: ${pc.dim(maskApiKey(config.apiKey))}`);
  console.log();

  outro('Configuration loaded.');
}

/** Updates one persisted configuration value. */
export async function configSetCommand(key: string, value: string): Promise<void> {
  if (!configExists()) {
    intro(pc.bold(pc.cyan('commit-echo config')));
    outro(pc.yellow('No configuration found. Run `commit-echo init` first.'));
    process.exit(1);
  }

  if (!isConfigSetKey(key)) {
    intro(pc.bold(pc.cyan('commit-echo config')));
    outro(pc.red(`Unknown config key: ${key}. Valid keys: ${CONFIG_SET_KEYS.join(', ')}`));
    process.exit(1);
  }

  let parsedValue: ConfigSetValueMap[ConfigSetKey];
  try {
    parsedValue = parseConfigSetValue(key, value);
  } catch (error) {
    intro(pc.bold(pc.cyan('commit-echo config')));
    outro(pc.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }

  const config = await loadRawConfig();
  const nextConfig: Config = {
    provider: config.provider ?? '',
    model: config.model ?? '',
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    historySize: config.historySize ?? DEFAULT_HISTORY_SIZE,
    maxDiffSize: config.maxDiffSize ?? DEFAULT_MAX_DIFF_SIZE,
    systemPromptTemplate: config.systemPromptTemplate,
    userPromptTemplate: config.userPromptTemplate,
  };

  await saveConfig(updateConfigField(nextConfig, key, parsedValue));

  intro(pc.bold(pc.cyan('commit-echo config')));
  outro(`Updated ${pc.cyan(key)}.`);
}
