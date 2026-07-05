import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import type { Config } from '../types.js';

export const DEFAULT_HISTORY_SIZE = 50;
export const DEFAULT_MAX_DIFF_SIZE = 4000;

/** Environment variable names for configuration overrides. Keep in sync with `loadConfig()`. */
export const CONFIG_ENV_VARS = [
  'COMMIT_ECHO_PROVIDER',
  'COMMIT_ECHO_MODEL',
  'COMMIT_ECHO_BASE_URL',
  'COMMIT_ECHO_API_KEY',
  'COMMIT_ECHO_HISTORY_SIZE',
  'COMMIT_ECHO_MAX_DIFF_SIZE',
] as const;

/**
 * Read a positive integer from an environment variable.
 * Returns the parsed integer if valid, undefined if unset, or throws if invalid.
 */
function readPositiveIntegerEnvVar(envVar: string): number | undefined {
  const raw = process.env[envVar];
  if (raw === undefined) return undefined;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${envVar} environment variable. Expected a positive integer, got: ${raw}`);
  }
  return parsed;
}

// Missing size settings keep defaults; malformed explicit values are rejected
// so runtime prompt and diff paths never receive unsafe limits.
function readPositiveIntegerConfigValue(
  value: unknown,
  name: 'historySize' | 'maxDiffSize',
  defaultValue: number,
  configPath: string,
): number {
  if (value === undefined) return defaultValue;
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;

  throw new Error(`Invalid ${name} in config file: ${configPath}. Expected a positive integer.`);
}

export function getConfigDir(): string {
  const home = homedir();
  const os = platform();

  if (os === 'win32') {
    const appData = process.env['APPDATA'];
    if (appData) return join(appData, 'commit-echo');
  } else if (os === 'darwin') {
    return join(home, 'Library', 'Application Support', 'commit-echo');
  }

  const xdg = process.env['XDG_CONFIG_HOME'];
  if (xdg) return join(xdg, 'commit-echo');

  return join(home, '.config', 'commit-echo');
}

export function getConfigPath(): string {
  return join(getConfigDir(), 'config.json');
}

export function getHistoryPath(): string {
  return join(getConfigDir(), 'history.jsonl');
}

async function readConfigFile(): Promise<Partial<Config>> {
  const configPath = getConfigPath();
  const raw = await readFile(configPath, 'utf-8');

  try {
    return JSON.parse(raw) as Partial<Config>;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(
        `Invalid JSON in config file: ${configPath}. Fix the JSON syntax or run \`commit-echo init\` to recreate it.`,
        { cause: error },
      );
    }
    throw error;
  }
}

function normalizeRawConfig(parsed: Partial<Config>, configPath: string): Partial<Config> {
  return {
    ...parsed,
    historySize:
      parsed.historySize === undefined
        ? undefined
        : readPositiveIntegerConfigValue(parsed.historySize, 'historySize', DEFAULT_HISTORY_SIZE, configPath),
    maxDiffSize:
      parsed.maxDiffSize === undefined
        ? undefined
        : readPositiveIntegerConfigValue(parsed.maxDiffSize, 'maxDiffSize', DEFAULT_MAX_DIFF_SIZE, configPath),
  };
}

export async function loadRawConfig(): Promise<Partial<Config>> {
  const configPath = getConfigPath();
  const parsed = await readConfigFile();
  return normalizeRawConfig(parsed, configPath);
}

export async function loadConfig(): Promise<Config> {
  const configPath = getConfigPath();
  const parsed = normalizeRawConfig(await readConfigFile(), configPath);

  // Resolve numeric config values with env var overrides.
  // Env vars take precedence over config file values.
  const envHistorySize = readPositiveIntegerEnvVar('COMMIT_ECHO_HISTORY_SIZE');
  const envMaxDiffSize = readPositiveIntegerEnvVar('COMMIT_ECHO_MAX_DIFF_SIZE');

  const historySize =
    envHistorySize ??
    readPositiveIntegerConfigValue(parsed.historySize, 'historySize', DEFAULT_HISTORY_SIZE, configPath);
  const maxDiffSize =
    envMaxDiffSize ??
    readPositiveIntegerConfigValue(parsed.maxDiffSize, 'maxDiffSize', DEFAULT_MAX_DIFF_SIZE, configPath);

  return {
    provider: (process.env['COMMIT_ECHO_PROVIDER'] ?? parsed.provider ?? '').trim(),
    model: (process.env['COMMIT_ECHO_MODEL'] ?? parsed.model ?? '').trim(),
    baseUrl: (process.env['COMMIT_ECHO_BASE_URL'] ?? parsed.baseUrl)?.trim(),
    apiKey: (process.env['COMMIT_ECHO_API_KEY'] ?? parsed.apiKey)?.trim(),
    historySize,
    maxDiffSize,
    systemPromptTemplate: parsed.systemPromptTemplate,
    userPromptTemplate: parsed.userPromptTemplate,
  };
}

export async function saveConfig(config: Config): Promise<void> {
  const configDir = getConfigDir();
  if (!existsSync(configDir)) {
    await mkdir(configDir, { recursive: true });
  }
  await writeFile(getConfigPath(), JSON.stringify(config, null, 2), 'utf-8');
}

export function configExists(): boolean {
  return existsSync(getConfigPath());
}

export async function loadOrPromptConfig(): Promise<Config> {
  if (!configExists()) {
    throw new Error('No configuration found. Run `commit-echo init` to set up your provider and model.');
  }
  return loadConfig();
}
