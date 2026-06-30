import { intro, outro, select, text, confirm, spinner, isCancel, note } from '@clack/prompts';
import pc from 'picocolors';
import { BUILTIN_PROVIDERS, getProviderInfo, fetchModels } from '../providers/index.js';
import { saveConfig, configExists, loadConfig } from '../config/store.js';
import type { Config } from '../types.js';
import { getAvailableTemplateVars } from '../llm/prompt.js';
import { installPrepareCommitMsgHook } from '../git/hook.js';

const CUSTOM_KEY = '__custom__';

export function buildApiKeyPrompt(existingKey: string, apiKeyEnv: string) {
  return {
    message: `Enter your API key (will be stored in config), or leave blank to use ${pc.cyan(`$${apiKeyEnv}`)} env var:`,
    placeholder: existingKey ? '•••••••• (already configured)' : '',
  };
}

export async function initCommand(options: { installHook?: boolean } = {}): Promise<void> {
  intro(pc.bold(pc.cyan('commit-echo init')));

  const isReconfig = configExists();
  const existingConfig = isReconfig ? await loadConfig().catch(() => null) : null;

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

  const providerNames = BUILTIN_PROVIDERS.map((p) => ({
    value: p.key,
    label: p.name,
    hint: p.website,
  }));

  providerNames.push({
    value: CUSTOM_KEY,
    label: 'Custom (OpenAI-compatible)',
    hint: 'Any OpenAI-compatible API endpoint',
  });

  const providerKey = await select({
    message: 'Select an LLM provider:',
    options: providerNames,
    initialValue: existingConfig?.provider,
  });

  if (isCancel(providerKey)) {
    outro('Setup cancelled.');
    return;
  }

  let baseUrl: string | undefined;
  let apiKeyEnv = '';
  let apiKey: string | undefined;
  let needsApiKey = true;

  if (providerKey === CUSTOM_KEY) {
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
    if (isCancel(urlResult)) {
      outro('Setup cancelled.');
      return;
    }
    baseUrl = urlResult;
    apiKeyEnv = 'CUSTOM_API_KEY';
    needsApiKey = true;
  } else {
    const info = getProviderInfo(providerKey as string);
    if (!info) {
      outro('Invalid provider selected.');
      return;
    }
    baseUrl = existingConfig?.baseUrl ?? info.baseUrl;
    apiKeyEnv = info.apiKeyEnv;
    needsApiKey = info.needsApiKey;
  }

  if (needsApiKey) {
    const existingKey = existingConfig?.apiKey ?? process.env[apiKeyEnv] ?? '';
    const keyResult = await text(buildApiKeyPrompt(existingKey, apiKeyEnv));
    if (isCancel(keyResult)) {
      outro('Setup cancelled.');
      return;
    }

    if (keyResult) {
      apiKey = keyResult;
    } else if (existingKey) {
      apiKey = existingKey;
    } else {
      apiKey = '';
    }
  }

  const modelSpinner = spinner();
  modelSpinner.start('Fetching available models...');

  let models: string[];
  try {
    models = await fetchModels(providerKey as string, providerKey === CUSTOM_KEY ? baseUrl : undefined, apiKey ?? '');
    modelSpinner.stop('Models fetched successfully.');
  } catch (err) {
    modelSpinner.stop(pc.yellow('Could not fetch models automatically.'));
    const manualResult = await text({
      message: 'Enter model name manually:',
      placeholder: existingConfig?.model ?? 'gpt-4o',
      validate: (value) => {
        if (!value) return 'Model name is required';
      },
    });
    if (isCancel(manualResult)) {
      outro('Setup cancelled.');
      return;
    }
    models = [manualResult];
  }

  const modelOptions = models.map((m) => ({ value: m, label: m }));
  const selectedModel = await select({
    message: 'Select a model:',
    options: modelOptions,
    initialValue: existingConfig?.model,
  });

  if (isCancel(selectedModel)) {
    outro('Setup cancelled.');
    return;
  }

  const historyResult = await text({
    message: 'Number of recent commits to learn from:',
    placeholder: '50',
    initialValue: String(existingConfig?.historySize ?? 50),
    validate: (value) => {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1) return 'Enter a positive integer';
    },
  });
  if (isCancel(historyResult)) {
    outro('Setup cancelled.');
    return;
  }

  const maxDiffResult = await text({
    message: 'Maximum diff size (characters) to send to the LLM:',
    placeholder: '4000',
    initialValue: String(existingConfig?.maxDiffSize ?? 4000),
    validate: (value) => {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1) return 'Enter a positive integer';
    },
  });
  if (isCancel(maxDiffResult)) {
    outro('Setup cancelled.');
    return;
  }

  const useCustomPrompts = await confirm({
    message: 'Set custom prompt templates? (Advanced)',
    initialValue: false,
  });
  if (isCancel(useCustomPrompts)) {
    outro('Setup cancelled.');
    return;
  }

  let systemPromptTemplate: string | undefined;
  let userPromptTemplate: string | undefined;

  if (useCustomPrompts) {
    note(`\nAvailable variables:\n${getAvailableTemplateVars()}\n` + `Leave empty to use the built-in prompt.\n`);

    const sysResult = await text({
      message: 'Custom system prompt template (optional):',
      placeholder: 'You are a commit assistant...',
      initialValue: existingConfig?.systemPromptTemplate,
    });
    if (isCancel(sysResult)) {
      outro('Setup cancelled.');
      return;
    }
    if (sysResult) {
      systemPromptTemplate = sysResult;
    }

    const userResult = await text({
      message: 'Custom user prompt template (optional):',
      placeholder: 'Generate commit messages for:\n{{diff}}',
      initialValue: existingConfig?.userPromptTemplate,
    });
    if (isCancel(userResult)) {
      outro('Setup cancelled.');
      return;
    }
    if (userResult) {
      userPromptTemplate = userResult;
    }
  }

  const config: Config = {
    provider: providerKey as string,
    model: selectedModel as string,
    baseUrl: providerKey === CUSTOM_KEY ? baseUrl : undefined,
    apiKey: apiKey ?? undefined,
    historySize: Number(historyResult),
    maxDiffSize: Number(maxDiffResult),
    systemPromptTemplate,
    userPromptTemplate,
  };

  const persistSetup = async () => {
    await saveConfig(config);

    if (options.installHook) {
      try {
        const hookPath = await installPrepareCommitMsgHook();
        console.log(pc.green(`Installed prepare-commit-msg hook at ${hookPath}`));
      } catch (err) {
        console.warn(
          pc.yellow(`Could not install prepare-commit-msg hook: ${err instanceof Error ? err.message : String(err)}`),
        );
      }
    }
  };

  if (needsApiKey && !config.apiKey && !process.env[apiKeyEnv]) {
    await persistSetup();
    const warn = pc.yellow(
      `\n⚠  No API key provided. Make sure to set ${pc.cyan(`$${apiKeyEnv}`)} before running suggestions.`,
    );
    outro(warn);
    return;
  }

  const testSpinner = spinner();
  testSpinner.start('Testing connection...');
  try {
    const resolvedKey = config.apiKey ?? process.env[apiKeyEnv] ?? '';
    if (!resolvedKey && needsApiKey) {
      testSpinner.stop(pc.yellow('Skipped (no API key).'));
    } else {
      const testConfig = { ...config, apiKey: resolvedKey };
      const { testConnection } = await import('../llm/client.js');
      const modelName = await testConnection(testConfig);
      testSpinner.stop(pc.green(`Connected successfully using ${pc.bold(modelName)}.`));
    }
  } catch (err) {
    testSpinner.stop(pc.red(`Connection failed: ${err instanceof Error ? err.message : 'Unknown error'}`));
    const proceed = await confirm({
      message: 'Connection test failed. Save configuration anyway?',
      initialValue: false,
    });
    if (isCancel(proceed) || !proceed) {
      outro('Setup cancelled.');
      return;
    }
  }

  await persistSetup();

  const displayKey = config.apiKey ? 'stored in config' : `\$${apiKeyEnv}`;
  const displayUrl = providerKey === CUSTOM_KEY ? baseUrl : getProviderInfo(providerKey as string)?.baseUrl;

  const templateInfo =
    config.systemPromptTemplate || config.userPromptTemplate
      ? `\n  Custom prompts: ${pc.dim(config.systemPromptTemplate ? 'system ✓' : '')}${config.systemPromptTemplate && config.userPromptTemplate ? ', ' : ''}${pc.dim(config.userPromptTemplate ? 'user ✓' : '')}`
      : '';

  outro(
    `${pc.green('✓')} Configuration saved.\n` +
      `  Provider: ${pc.cyan(providerKey as string)}\n` +
      `  Model: ${pc.cyan(config.model)}\n` +
      `  Endpoint: ${pc.dim(displayUrl ?? '')}\n` +
      `  API key: ${pc.dim(displayKey)}` +
      templateInfo +
      `\n\nRun ${pc.bold('commit-echo')} after staging changes to get commit suggestions.`,
  );
}
