import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  getConfig,
  updateConfig,
  setProviderConfig,
  clearConfig,
} from "../config/manager.js";
import { listProviders } from "../providers/registry.js";
import { learnStyle } from "../learning/profile.js";
import { success, info } from "../utils/logger.js";

export async function runInit(): Promise<void> {
  console.log(pc.bold(pc.cyan("\n  commit-echo setup\n")));

  let existing;
  try {
    existing = getConfig();
  } catch {
    info("Config is corrupted or missing. Starting fresh.");
    clearConfig();
    existing = { initialized: false };
  }
  if (existing.initialized) {
    const shouldReset = await p.confirm({
      message: "Configuration already exists. Reset and re-run setup?",
      initialValue: false,
    });
    if (p.isCancel(shouldReset)) process.exit(0);
    if (shouldReset) clearConfig();
    else {
      info("Keeping existing configuration.");
      return;
    }
  }

  const providers = listProviders();

  const providerChoice = await p.select({
    message: "Pick your LLM provider:",
    options: providers.map((pr) => ({
      label: pr.displayName,
      value: pr.name,
      hint: pr.models.slice(0, 2).join(", "),
    })),
  });
  if (p.isCancel(providerChoice)) process.exit(0);

  const selectedProvider = providers.find((pr) => pr.name === providerChoice)!;

  const modelChoice = await p.select({
    message: "Select model:",
    options: selectedProvider.models.map((m) => ({ label: m, value: m })),
  });
  if (p.isCancel(modelChoice)) process.exit(0);

  const envVarName = `ECHO_${selectedProvider.name.toUpperCase()}_API_KEY`;
  const standardEnvVar = `${selectedProvider.name.toUpperCase()}_API_KEY`;
  const envValue = process.env[envVarName] || process.env[standardEnvVar] || "";

  let apiKey = "";
  if (selectedProvider.requiresApiKey) {
    const apiKeyInput = await p.text({
      message: `Enter API key (or set ${envVarName} or ${standardEnvVar} env var):`,
      initialValue: envValue,
      validate: (val) => {
        if (!val && !envValue) return "API key is required";
        return;
      },
    });
    if (p.isCancel(apiKeyInput)) process.exit(0);
    apiKey = apiKeyInput as string;
    if (!apiKey && envValue) apiKey = envValue;
  }

  const baseUrlInput = await p.text({
    message: "Base URL (optional, leave blank for default):",
    initialValue: selectedProvider.name === "ollama" ? "http://localhost:11434" : "",
  });
  if (p.isCancel(baseUrlInput)) process.exit(0);
  const baseUrl = baseUrlInput as string;

  const useConventional = await p.confirm({
    message: "Use conventional commits format? (feat:, fix:, chore:, etc.)",
    initialValue: true,
  });
  if (p.isCancel(useConventional)) process.exit(0);

  updateConfig({
    provider: selectedProvider.name,
    model: modelChoice as string,
    conventionalCommits: useConventional as boolean,
  });

  setProviderConfig(selectedProvider.name, {
    apiKey: apiKey || undefined,
    baseUrl: baseUrl || undefined,
  });

  info("Analyzing your recent commit history...");
  await learnStyle();

  updateConfig({ initialized: true });

  success("Setup complete!");
  info(`Run \`${pc.cyan("commit-echo")}\` to generate a commit message for staged changes.`);
}
