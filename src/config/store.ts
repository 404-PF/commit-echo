import { readFile, writeFile, mkdir, chmod, rename, rm } from 'node:fs/promises';
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

const configCache = new Map<string, Promise<Config>>();

/**
 * Clear cached config so the next loadConfig() reads from disk again.
 * When a path is given, only that path's entry is cleared; otherwise the
 * entire process-lifetime cache is cleared.
 */
export function invalidateConfigCache(configPath?: string): void {
  if (configPath) {
    configCache.delete(configPath);
  } else {
    configCache.clear();
  }
}

/**
 * Best-effort tightening of permissions on an existing config directory and
 * file. Upgrades from releases that wrote `config.json` as world-readable
 * (e.g. 0644) keep those lax permissions until the file is rewritten, so the
 * stored API key stays readable by other local users on the normal read path.
 * Calling this from the load path migrates existing installations. Failures are
 * ignored because chmod is unsupported or a no-op on some platforms (e.g.
 * Windows) and must never break config loading.
 */
export async function secureConfigPermissions(): Promise<void> {
  try {
    await chmod(getConfigDir(), 0o700);
  } catch {
    // best-effort; ignore unsupported platforms or ownership errors
  }

  try {
    await chmod(getConfigPath(), 0o600);
  } catch {
    // best-effort; ignore unsupported platforms or ownership errors
  }
}

export function loadConfig(): Promise<Config> {
  const configPath = getConfigPath();

  // Migrate permissions on the read path so pre-existing lax configs are
  // hardened even when the file is never rewritten (e.g. `suggest`). Best-effort
  // and fire-and-forget so config caching below stays synchronous.
  secureConfigPermissions().catch(() => {});

  const cached = configCache.get(configPath);
  if (cached) return cached;

  // Create the load promise synchronously and cache it before any await, so
  // concurrent callers share a single in-flight load instead of each reading
  // the file. The promise is set here once; a later invalidateConfigCache()
  // removes it and cannot be re-populated by a stale completed load, since we
  // never re-insert the resolved value after awaiting.
  const loadPromise = (async (): Promise<Config> => {
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
  })();

  configCache.set(configPath, loadPromise);

  // If the load fails, drop the rejected promise so a retry re-reads the file.
  loadPromise.catch(() => {
    if (configCache.get(configPath) === loadPromise) {
      configCache.delete(configPath);
    }
  });

  return loadPromise;
}

export async function saveConfig(config: Config): Promise<void> {
  const configDir = getConfigDir();
  await mkdir(configDir, { recursive: true, mode: 0o700 });
  await chmod(configDir, 0o700);

  const configPath = getConfigPath();
  const content = JSON.stringify(config, null, 2);

  // Write to a fresh temp file with restrictive permissions, then atomically
  // replace the target. Reusing a pre-existing world-readable inode (e.g. a
  // 0644 config.json from an older release) would briefly expose the new API
  // key before the later chmod, so the secret is never written in place.
  const tmpPath = `${configPath}.${process.pid}.tmp`;
  await writeFile(tmpPath, content, { encoding: 'utf-8', mode: 0o600 });

  try {
    try {
      await rename(tmpPath, configPath);
    } catch (error) {
      if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'EEXIST') {
        // Windows cannot rename over an existing file. Fall back to a
        // non-atomic replace; permissions are still enforced by the chmod below.
        await rm(configPath, { force: true });
        await rename(tmpPath, configPath);
      } else {
        throw error;
      }
    }
  } finally {
    await rm(tmpPath, { force: true });
  }

  await chmod(configPath, 0o600);
  invalidateConfigCache(configPath);
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
