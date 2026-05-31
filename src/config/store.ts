import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import type { Config } from '../types.js';

const DEFAULT_HISTORY_SIZE = 50;
const DEFAULT_MAX_DIFF_SIZE = 4000;

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
  const parsed = JSON.parse(raw) as Partial<Config>;

  return {
    provider: parsed.provider ?? '',
    model: parsed.model ?? '',
    baseUrl: parsed.baseUrl,
    apiKey: parsed.apiKey,
    historySize: parsed.historySize ?? DEFAULT_HISTORY_SIZE,
    maxDiffSize: parsed.maxDiffSize ?? DEFAULT_MAX_DIFF_SIZE,
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
    throw new Error(
      'No configuration found. Run `commit-echo init` to set up your provider and model.'
    );
  }
  return loadConfig();
}
