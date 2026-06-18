import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import type { Config } from '../types.js';

const DEFAULT_HISTORY_SIZE = 50;
const DEFAULT_MAX_DIFF_SIZE = 4000;

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

export async function loadConfig(): Promise<Config> {
  const configPath = getConfigPath();
  const raw = await readFile(configPath, 'utf-8');
  let parsed: Partial<Config> = {};

  try {
    parsed = JSON.parse(raw) as Partial<Config>;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(
        `Invalid JSON in config file: ${configPath}. Fix the JSON syntax or run \`commit-echo init\` to recreate it.`,
        { cause: error },
      );
    }
    throw error;
  }

  return {
    provider: parsed.provider ?? '',
    model: parsed.model ?? '',
    baseUrl: parsed.baseUrl,
    apiKey: parsed.apiKey,
    historySize: readPositiveIntegerConfigValue(parsed.historySize, 'historySize', DEFAULT_HISTORY_SIZE, configPath),
    maxDiffSize: readPositiveIntegerConfigValue(parsed.maxDiffSize, 'maxDiffSize', DEFAULT_MAX_DIFF_SIZE, configPath),
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
