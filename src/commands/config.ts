import { intro, outro } from '@clack/prompts';
import pc from 'picocolors';
import { configExists, loadConfig } from '../config/store.js';
import { getProviderInfo } from '../providers/index.js';
import type { Config } from '../types.js';

const CUSTOM_PROVIDER_KEY = '__custom__';

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

/** Displays the current commit-echo configuration without exposing secret values. */
export async function configCommand(): Promise<void> {
  intro(pc.bold(pc.cyan('commit-echo config')));

  if (!configExists()) {
    outro(pc.yellow('No configuration found. Run `commit-echo init` first.'));
    return;
  }

  const config = await loadConfig();

  console.log(pc.bold('\nCurrent Configuration\n'));
  console.log(`  Provider: ${pc.cyan(formatProvider(config))}`);
  console.log(`  Model: ${pc.cyan(config.model || 'not configured')}`);
  console.log(`  Endpoint: ${pc.dim(resolveEndpoint(config))}`);
  console.log(`  History size: ${pc.bold(String(config.historySize))}`);
  console.log(`  API key: ${pc.dim(maskApiKey(config.apiKey))}`);
  console.log();

  outro('Configuration loaded.');
}
