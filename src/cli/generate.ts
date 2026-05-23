import * as p from "@clack/prompts";
import pc from "picocolors";
import { getStagedDiff } from "../git/diff.js";
import { getConfig } from "../config/manager.js";
import { getProvider } from "../providers/registry.js";
import { getCurrentProfile, learnStyle } from "../learning/profile.js";
import type { GenerateContext, LLMProvider } from "../providers/types.js";
import { getApiKey, getProviderConfig } from "../config/manager.js";
import { ApiKeyMissingError, NoStagedChangesError } from "../utils/errors.js";
import { error, info } from "../utils/logger.js";

interface GenerateOptions {
  provider?: string;
  model?: string;
}

export interface GenerateResult {
  message: string;
}

async function resolveProvider(opts: GenerateOptions): Promise<LLMProvider> {
  const cfg = getConfig();
  const providerName = (opts.provider ?? cfg.provider).toLowerCase();
  const provider = getProvider(providerName);
  const providerCfg = getProviderConfig(providerName);
  const model = opts.model ?? providerCfg.model ?? cfg.model;
  const apiKey = getApiKey(providerName);

  if (!apiKey && provider.requiresApiKey) {
    throw new ApiKeyMissingError(provider.displayName);
  }

  provider.configure({
    apiKey: apiKey ?? "",
    model,
    baseUrl: providerCfg.baseUrl,
  });

  return provider;
}

function printMessage(msg: string): void {
  const line = pc.gray("─".repeat(60));
  console.log(`\n${line}`);
  console.log(msg);
  console.log(`${line}\n`);
}

export async function runGenerate(opts: GenerateOptions = {}): Promise<GenerateResult | null> {
  try {
    const diffContext = await getStagedDiff();
    const cfg = getConfig();
    let profile = getCurrentProfile();

    if (!profile) {
      info("No style profile yet. Analyzing commits...");
      profile = await learnStyle();
    }

    info(`Generating message for ${diffContext.changedFiles.length} staged file(s)...`);

    const provider = await resolveProvider(opts);

    const genContext: GenerateContext = {
      ...diffContext,
      styleProfile: profile,
      conventionalCommits: cfg.conventionalCommits,
      maxSubjectLength: cfg.maxSubjectLength,
    };

    let message: string;

    while (true) {
      message = await provider.generate(genContext);
      printMessage(message);

      const action = await p.select({
        message: "What would you like to do?",
        options: [
          { label: "Accept", value: "accept", hint: "Use this message" },
          { label: "Edit", value: "edit", hint: "Open editor to modify" },
          { label: "Regenerate", value: "regenerate", hint: "Try again" },
          { label: "Cancel", value: "cancel", hint: "Discard" },
        ],
      });

      if (p.isCancel(action) || action === "cancel") {
        info("Cancelled.");
        return null;
      }

      if (action === "regenerate") {
        info("Regenerating...");
        continue;
      }

      if (action === "edit") {
        const edited = await p.text({
          message: "Edit the commit message:",
          initialValue: message,
        });
        if (p.isCancel(edited)) {
          info("Cancelled.");
          return null;
        }
        return { message: edited as string };
      }

      return { message };
    }
  } catch (err) {
    if (err instanceof NoStagedChangesError) {
      error(err.message);
      info("Stage your changes with `git add` and try again.");
    } else {
      error(err instanceof Error ? err.message : String(err));
    }
    return null;
  }
}
