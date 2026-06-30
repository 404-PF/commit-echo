import { intro, outro } from '@clack/prompts';
import pc from 'picocolors';
import { configExists, loadConfig } from '../config/store.js';
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
