import { intro, outro, select, text, confirm, spinner, isCancel, note } from '@clack/prompts';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import pc from 'picocolors';
import {
  BUILTIN_PROVIDERS,
  CUSTOM_API_KEY_ENV,
  CUSTOM_PROVIDER_KEY,
  getProviderInfo,
  fetchModels,
} from '../providers/index.js';
import { saveConfig, configExists, loadConfig, loadRawConfig } from '../config/store.js';
import type { Config } from '../types.js';
import { getAvailableTemplateVars } from '../llm/prompt.js';
import { installCommitHooks, uninstallCommitHooks } from '../git/hook.js';
import type { UninstalledCommitHooks } from '../git/hook.js';

export function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

export function resolveBaseUrl(providerKey: string, existingBaseUrl?: string): string | undefined {
  return providerKey === CUSTOM_PROVIDER_KEY ? existingBaseUrl : getProviderInfo(providerKey)?.baseUrl;
}

export function buildApiKeyPrompt(existingKey: string, apiKeyEnv: string) {
  return {
    message: `Enter your API key (will be stored in config), or leave blank to use ${pc.cyan(`${apiKeyEnv}`)} env var:`,
    placeholder: existingKey ? '•••••••• (already configured)' : '',
  };
}

export function getStoredApiKeyForProvider(
  selectedProvider: string,
  storedConfig: Pick<Partial<Config>, 'provider' | 'apiKey'> | null,
): string | undefined {
  return storedConfig?.provider === selectedProvider ? storedConfig.apiKey : undefined;
}

/**
 * A template file takes precedence over inline templates at runtime, so drop
 * inline values when a templatePath is set to keep the saved config consistent
 * with the effective behavior.
 */
export function withTemplateFilePrecedence(
  systemPromptTemplate: string | undefined,
  userPromptTemplate: string | undefined,
  templatePath: string | undefined,
): { systemPromptTemplate?: string; userPromptTemplate?: string } {
  if (templatePath) {
    return { systemPromptTemplate: undefined, userPromptTemplate: undefined };
  }
  return { systemPromptTemplate, userPromptTemplate };
}

function hasUninstallChanges(result: UninstalledCommitHooks): boolean {
  return (
    result.restored.length > 0 || result.removed.length > 0 || result.skipped.length > 0 || result.unreadable.length > 0
  );
}

function printHookPaths(label: string, paths: string[]): void {
  if (paths.length === 0) return;
  console.log(pc.green(`${label}:`));
  for (const hookPath of paths) {
    console.log(`  ${hookPath}`);
  }
}

function printUninstallResult(result: UninstalledCommitHooks): void {
  if (!hasUninstallChanges(result)) {
    console.log(pc.yellow('No commit-echo-managed hooks found.'));
    return;
  }

  printHookPaths('Restored existing hooks', result.restored);
  printHookPaths('Removed commit-echo hooks', result.removed);
  if (result.removed.length > 0) {
    console.log(pc.dim(`Removed ${result.removed.length} hook(s) created by commit-echo.`));
  }
  if (result.skipped.length > 0) {
    console.log(pc.yellow(`Skipped ${result.skipped.length} hook(s) that are not managed by commit-echo.`));
  }
  if (result.unreadable.length > 0) {
    console.log(pc.yellow(`Could not inspect ${result.unreadable.length} hook(s); left them unchanged.`));
  }
}

async function uninstallHooksCommand(): Promise<void> {
  try {
    const result = await uninstallCommitHooks();
    printUninstallResult(result);
    if (result.unreadable.length > 0) {
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(pc.red(`Could not uninstall commit-echo hooks: ${err instanceof Error ? err.message : String(err)}`));
    process.exitCode = 1;
  }
}

interface ProviderSetup {
  providerKey: string;
  baseUrl?: string;
  apiKeyEnv: string;
  needsApiKey: boolean;
}

async function promptProvider(existingConfig: Config | null): Promise<ProviderSetup | null> {
  const providerOptions = BUILTIN_PROVIDERS.map((p) => ({
    value: p.key,
    label: p.name,
    hint: p.website,
  }));
  providerOptions.push({
    value: CUSTOM_PROVIDER_KEY,
    label: 'Custom (OpenAI-compatible)',
    hint: 'Any OpenAI-compatible API endpoint',
  });

  const providerKey = await select({
    message: 'Select an LLM provider:',
    options: providerOptions,
    initialValue: existingConfig?.provider,
  });
  if (isCancel(providerKey)) return null;

  if (providerKey === CUSTOM_PROVIDER_KEY) {
    const urlResult = await text({
      message: 'Enter the base URL for your OpenAI-compatible API:',
      placeholder: 'https://api.example.com/v1',
      initialValue: existingConfig?.baseUrl,
      validate: (value) => {
        if (!value) return 'Base URL is required';
        try {
          new URL(value);
        } catch {
          return 'Invalid URL format';
        }
      },
    });
    if (isCancel(urlResult)) return null;
    return { providerKey, baseUrl: normalizeBaseUrl(urlResult), apiKeyEnv: CUSTOM_API_KEY_ENV, needsApiKey: true };
  }

  const info = getProviderInfo(providerKey);
  if (!info) {
    outro('Invalid provider selected.');
    return null;
  }
  return { providerKey, baseUrl: info.baseUrl, apiKeyEnv: info.apiKeyEnv, needsApiKey: info.needsApiKey };
}

async function promptApiKey(
  provider: ProviderSetup,
  storedConfig: Pick<Config, 'provider' | 'apiKey'> | null,
): Promise<string | undefined | null> {
  if (!provider.needsApiKey) return undefined;

  const existingKey = getStoredApiKeyForProvider(provider.providerKey, storedConfig) ?? process.env[provider.apiKeyEnv] ?? '';
  const keyResult = await text(buildApiKeyPrompt(existingKey, provider.apiKeyEnv));
  if (isCancel(keyResult)) return null;
  return keyResult || existingKey || '';
}

async function promptModel(
  provider: ProviderSetup,
  apiKey: string | undefined,
  existingConfig: Config | null,
): Promise<string | null> {
  const modelSpinner = spinner();
  modelSpinner.start('Fetching available models...');

  let models: string[];
  try {
    models = await fetchModels(
      provider.providerKey,
      provider.providerKey === CUSTOM_PROVIDER_KEY ? provider.baseUrl : undefined,
      apiKey ?? '',
    );
    modelSpinner.stop('Models fetched successfully.');
  } catch {
    modelSpinner.stop(pc.yellow('Could not fetch models automatically.'));
    const manualResult = await text({
      message: 'Enter model name manually:',
      placeholder: existingConfig?.model ?? 'gpt-4o',
      validate: (value) => {
        if (!value) return 'Model name is required';
      },
    });
    if (isCancel(manualResult)) return null;
    models = [manualResult];
  }

  const selectedModel = await select({
    message: 'Select a model:',
    options: models.map((model) => ({ value: model, label: model })),
    initialValue: existingConfig?.model,
  });
  return isCancel(selectedModel) ? null : selectedModel;
}

interface HistoryLimits {
  historySize: number;
  maxDiffSize: number;
}

async function promptHistoryLimits(existingConfig: Config | null): Promise<HistoryLimits | null> {
  const historyResult = await text({
    message: 'Number of recent commits to learn from:',
    placeholder: '50',
    initialValue: String(existingConfig?.historySize ?? 50),
    validate: (value) => {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1) return 'Enter a positive integer';
    },
  });
  if (isCancel(historyResult)) return null;

  const maxDiffResult = await text({
    message: 'Maximum diff size (characters) to send to the LLM:',
    placeholder: '4000',
    initialValue: String(existingConfig?.maxDiffSize ?? 4000),
    validate: (value) => {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1) return 'Enter a positive integer';
    },
  });
  if (isCancel(maxDiffResult)) return null;
  return { historySize: Number(historyResult), maxDiffSize: Number(maxDiffResult) };
}

interface PromptTemplates {
  templatePath?: string;
  systemPromptTemplate?: string;
  userPromptTemplate?: string;
}

async function promptCustomTemplates(existingConfig: Config | null): Promise<PromptTemplates | null> {
  note(`\nAvailable variables:\n${getAvailableTemplateVars()}\n` + `Leave empty to use the built-in prompt.\n`);
  const sysResult = await text({
    message: 'Custom system prompt template (optional):',
    placeholder: 'You are a commit assistant...',
    initialValue: existingConfig?.systemPromptTemplate,
  });
  if (isCancel(sysResult)) return null;

  const userResult = await text({
    message: 'Custom user prompt template (optional):',
    placeholder: 'Generate commit messages for:\n{{diff}}',
    initialValue: existingConfig?.userPromptTemplate,
  });
  if (isCancel(userResult)) return null;
  return { systemPromptTemplate: sysResult || undefined, userPromptTemplate: userResult || undefined };
}

async function promptTemplates(existingConfig: Config | null): Promise<PromptTemplates | null> {
  const useTemplateFile = await confirm({
    message: 'Load templates from a file instead? (Advanced)',
    initialValue: Boolean(existingConfig?.templatePath),
  });
  if (isCancel(useTemplateFile)) return null;

  if (useTemplateFile) {
    note(
      `\nAvailable variables:\n${getAvailableTemplateVars()}\n` +
        `Use --- on its own line to separate system prompt (above) from user prompt (below).\n` +
        `Without a separator, the entire file is used as the system prompt.\n`,
    );
    const pathResult = await text({
      message: 'Path to prompt template file:',
      placeholder: '/path/to/commit-template.md',
      initialValue: existingConfig?.templatePath,
      validate: (value) => {
        if (!value) return 'Path is required';
        if (!existsSync(value)) return 'File not found. Enter an existing file path.';
        try {
          if (!statSync(value).isFile()) return 'Path is not a regular file';
        } catch {
          return 'Invalid file path';
        }
      },
    });
    return isCancel(pathResult) ? null : { templatePath: resolve(pathResult) };
  }

  const useCustomPrompts = await confirm({
    message: 'Set custom prompt templates? (Advanced)',
    initialValue: false,
  });
  if (isCancel(useCustomPrompts)) return null;
  return useCustomPrompts ? promptCustomTemplates(existingConfig) : {};
}

async function persistSetup(
  config: Config,
  options: { installHook?: boolean; uninstallHook?: boolean },
): Promise<void> {
  await saveConfig(config);
  if (!options.installHook) return;

  try {
    const { prepareCommitMsgPath, postCommitPath } = await installCommitHooks();
    console.log(pc.green('Installed commit-echo hooks:'));
    console.log(`  prepare-commit-msg: ${prepareCommitMsgPath}`);
    console.log(`  post-commit: ${postCommitPath}`);
  } catch (err) {
    throw new Error(`Could not install commit-echo hooks: ${err instanceof Error ? err.message : String(err)}`, {
      cause: err,
    });
  }
}

async function testConfiguration(config: Config, provider: ProviderSetup): Promise<boolean> {
  const testSpinner = spinner();
  testSpinner.start('Testing connection...');
  try {
    const resolvedKey = config.apiKey ?? process.env[provider.apiKeyEnv] ?? '';

    const { testConnection } = await import('../llm/client.js');
    const modelName = await testConnection({ ...config, apiKey: resolvedKey });
    testSpinner.stop(pc.green(`Connected successfully using ${pc.bold(modelName)}.`));
    return true;
  } catch (err) {
    testSpinner.stop(pc.red(`Connection failed: ${err instanceof Error ? err.message : 'Unknown error'}`));
    const proceed = await confirm({
      message: 'Connection test failed. Save configuration anyway?',
      initialValue: false,
    });
    return !isCancel(proceed) && proceed;
  }
}

function buildTemplateInfo(config: Config): string {
  if (config.templatePath) return `\n  Template file: ${pc.dim(config.templatePath)}`;
  if (!config.systemPromptTemplate && !config.userPromptTemplate) return '';

  const parts: string[] = [];
  if (config.systemPromptTemplate) parts.push(pc.dim('system ✓'));
  if (config.userPromptTemplate) parts.push(pc.dim('user ✓'));
  return `\n  Custom prompts: ${parts.join(', ')}`;
}

interface CollectedSetup {
  config: Config;
  provider: ProviderSetup;
}

async function collectConfig(
  existingConfig: Config | null,
  storedConfig: Pick<Config, 'provider' | 'apiKey'> | null,
): Promise<CollectedSetup | null> {
  const provider = await promptProvider(existingConfig);
  if (!provider) return null;

  const apiKey = await promptApiKey(provider, storedConfig);
  if (apiKey === null) return null;

  const selectedModel = await promptModel(provider, apiKey, existingConfig);
  if (!selectedModel) return null;

  const limits = await promptHistoryLimits(existingConfig);
  if (!limits) return null;

  const templates = await promptTemplates(existingConfig);
  if (!templates) return null;

  return {
    provider,
    config: {
      provider: provider.providerKey,
      model: selectedModel,
      baseUrl: provider.providerKey === CUSTOM_PROVIDER_KEY ? provider.baseUrl : undefined,
      apiKey: apiKey ?? undefined,
      historySize: limits.historySize,
      maxDiffSize: limits.maxDiffSize,
      ...withTemplateFilePrecedence(
        templates.systemPromptTemplate,
        templates.userPromptTemplate,
        templates.templatePath,
      ),
      templatePath: templates.templatePath,
    },
  };
}

async function runInteractiveSetup(options: { installHook?: boolean; uninstallHook?: boolean }): Promise<void> {
  intro(pc.bold(pc.cyan('commit-echo init')));

  const isReconfig = configExists();
  const existingConfig = isReconfig ? await loadConfig().catch(() => null) : null;
  const storedConfig = isReconfig ? await loadRawConfig().catch(() => null) : null;

  if (isReconfig) {
    const reconfirm = await confirm({
      message: `Configuration already exists. Do you want to reconfigure?`,
      initialValue: false,
    });
    if (isCancel(reconfirm) || !reconfirm) {
      outro('Setup cancelled.');
      return;
    }
  }

  const setup = await collectConfig(existingConfig, storedConfig);
  if (!setup) {
    outro('Setup cancelled.');
    return;
  }

  const { config, provider } = setup;

  if (provider.needsApiKey && !config.apiKey && !process.env[provider.apiKeyEnv]) {
    await persistSetup(config, options);
    const apiKeyEnv = pc.cyan(`$${provider.apiKeyEnv}`);
    const warn = pc.yellow(`\n⚠  No API key provided. Make sure to set ${apiKeyEnv} before running suggestions.`);
    outro(warn);
    return;
  }

  if (!(await testConfiguration(config, provider))) {
    outro('Setup cancelled.');
    return;
  }

  await persistSetup(config, options);

  const displayKey = config.apiKey ? 'stored in config' : `$${provider.apiKeyEnv}`;
  const displayUrl =
    provider.providerKey === CUSTOM_PROVIDER_KEY ? provider.baseUrl : getProviderInfo(provider.providerKey)?.baseUrl;

  outro(
    `${pc.green('✓')} Configuration saved.\n` +
      `  Provider: ${pc.cyan(provider.providerKey)}\n` +
      `  Model: ${pc.cyan(config.model)}\n` +
      `  Endpoint: ${pc.dim(displayUrl ?? '')}\n` +
      `  API key: ${pc.dim(displayKey)}` +
      buildTemplateInfo(config) +
      `\n\nRun ${pc.bold('commit-echo')} after staging changes to get commit suggestions.`,
  );
}

export async function initCommand(options: { installHook?: boolean; uninstallHook?: boolean } = {}): Promise<void> {
  if (options.installHook && options.uninstallHook) {
    throw new Error('Use either --install-hook or --uninstall-hook, not both.');
  }
  if (options.uninstallHook) {
    await uninstallHooksCommand();
    return;
  }
  await runInteractiveSetup(options);
}
