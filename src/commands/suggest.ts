import {
  intro,
  outro,
  select,
  text,
  confirm,
  spinner,
  isCancel,
} from "@clack/prompts";
import pc from "picocolors";
import type {
  Config,
  Provider,
  StyleProfile,
  Suggestion,
  TruncationInfo,
} from "../types.js";
import { loadOrPromptConfig } from "../config/store.js";
import {
  checkGitRepo,
  getStagedDiff,
  getUnstagedDiff,
  commit,
} from "../git/diff.js";
import {
  assertApiKeyAvailable,
  generateSuggestions,
  generateSuggestionsStream,
} from "../llm/client.js";
import { appendEntry, buildProfile } from "../history/store.js";
import { parseSuggestions } from "../llm/prompt.js";
import { getStreamingProvider } from "../providers/index.js";

function showTruncationWarning(info: TruncationInfo): void {
  const pct = ((info.truncatedSize / info.originalSize) * 100).toFixed(1);
  console.warn(
    pc.yellow(
      `\n⚠  Diff truncated: ${info.originalSize} → ${info.truncatedSize} chars (${pct}%) ` +
        `— ${info.filesTruncated} file(s) affected. ` +
        `Adjust maxDiffSize in config to increase the limit.`,
    ),
  );
}

function showVerboseInfo(
  model: string,
  profile: StyleProfile,
  truncation?: TruncationInfo,
): void {
  const commonPrefixes =
    profile.commonPrefixes.length > 0
      ? profile.commonPrefixes.join(", ")
      : "none";

  console.log(pc.dim(`Model: ${model}`));
  console.log(
    pc.dim(
      `Style profile: ${profile.totalCommits} commit(s), avg length ${profile.avgLength.toFixed(1)}, ` +
        `imperative rate ${(profile.imperativeRate * 100).toFixed(1)}%, common prefixes: ${commonPrefixes}`,
    ),
  );
  console.log(
    pc.dim(
      truncation
        ? `Truncation: ${truncation.originalSize} -> ${truncation.truncatedSize} chars, ${truncation.filesTruncated} file(s) affected`
        : "Truncation: not applied",
    ),
  );
}

async function displaySuggestions(suggestions: Suggestion[]): Promise<void> {
  for (const s of suggestions) {
    const full = s.body ? `${s.message}\n  ${pc.dim(s.body)}` : s.message;
    console.log(`  ${pc.cyan(`${s.index}.`)} ${full}`);
  }
}

export async function suggestCommand(
  options: {
    commit?: boolean;
    autoCommit?: boolean;
    verbose?: boolean;
    model?: string;
    stream?: boolean;
  } = {},
): Promise<void> {
  intro(pc.bold(pc.cyan("commit-echo")));

  try {
    checkGitRepo();
  } catch (err) {
    outro(pc.red(err instanceof Error ? err.message : "Not a git repository."));
    return;
  }

  let config: Config;
  try {
    config = await loadOrPromptConfig();
  } catch (err) {
    outro(pc.red(err instanceof Error ? err.message : "Configuration error"));
    return;
  }

  if (options.model) {
    config.model = options.model;
  }

  let diffResult = getStagedDiff();

  if (!diffResult.hasChanges) {
    diffResult = getUnstagedDiff();
    if (!diffResult.hasChanges) {
      outro(
        pc.yellow(
          "No changes detected. Stage your changes first with `git add`.",
        ),
      );
      return;
    }
  }

  let apiKey: string;
  try {
    apiKey = assertApiKeyAvailable(config);
  } catch (err) {
    outro(pc.red(err instanceof Error ? err.message : "Missing API key"));
    return;
  }

  const profile = await buildProfile(config.historySize);

  let suggestions: Suggestion[];
  let truncation: TruncationInfo | undefined;
  let model: string;

  if (options.stream) {
    let streamProvider: Provider;
    try {
      streamProvider = getStreamingProvider(config.provider);
    } catch (err) {
      outro(pc.red(err instanceof Error ? err.message : "Streaming not supported"));
      return;
    }

    // Streaming mode: show text as it arrives
    console.log(pc.dim("Streaming suggestions...\n"));

    model = config.model;
    let accumulated = "";
    try {
      for await (const event of generateSuggestionsStream(
        config,
        diffResult.diff,
        profile,
        apiKey,
        streamProvider,
      )) {
        if (event.kind === "meta") {
          truncation = event.truncation;
          continue;
        }

        if (event.kind === "model") {
          model = event.model;
          continue;
        }

        accumulated += event.text;
        process.stdout.write(event.text);
      }
    } catch (err) {
      process.stdout.write("\n");
      const message = err instanceof Error ? err.message : "Unknown error";
      outro(pc.red(`Streaming failed: ${message}`));
      return;
    }
    process.stdout.write("\n\n");

    const parsed = parseSuggestions(accumulated);
    suggestions = parsed.map((p, i) => ({
      index: i + 1,
      message: p.message,
      body: p.body,
    }));

    if (suggestions.length === 0) {
      outro(
        pc.red(
          "Could not parse any suggestions from LLM response. The model may need a different prompt format.",
        ),
      );
      return;
    }
  } else {
    // Non-streaming mode: use spinner and wait for full response
    const genSpinner = spinner();
    genSpinner.start("Generating commit suggestions...");

    try {
      const result = await generateSuggestions(
        config,
        diffResult.diff,
        profile,
        apiKey,
      );
      suggestions = result.suggestions;
      truncation = result.truncation;
      model = result.model;
      genSpinner.stop(pc.green("Suggestions generated:"));
    } catch (err) {
      genSpinner.stop(pc.red("Failed to generate suggestions."));
      const message = err instanceof Error ? err.message : "Unknown error";
      outro(pc.red(message));
      return;
    }
  }

  if (options.verbose) {
    showVerboseInfo(model, profile, truncation);
  }

  if (truncation) {
    showTruncationWarning(truncation);
  }

  if (!options.stream) {
    await displaySuggestions(suggestions);
  }

  if (options.autoCommit && suggestions.length > 0) {
    const first = suggestions[0]!;
    if (options.commit !== false) {
      if (!diffResult.staged) {
        outro(
          pc.red(
            "Auto-commit requires staged changes. Stage your changes with `git add` and try again.",
          ),
        );
        process.exit(1);
      }
      await acceptAndCommit(first, config, diffResult.diff, true);
    } else {
      console.log(`\n  ${pc.green("Selected:")} ${pc.bold(first.message)}`);
      if (first.body) {
        console.log(`  ${pc.dim(first.body)}`);
      }
    }
    return;
  }

  try {
    const action = await select({
      message: "Choose an action:",
      options: [
        { value: "select", label: "Select a suggestion to commit" },
        { value: "regenerate", label: "Regenerate suggestions" },
        { value: "cancel", label: "Cancel" },
      ],
    });

    if (isCancel(action) || action === "cancel") {
      outro("Cancelled.");
      return;
    }

    if (action === "regenerate") {
      await suggestCommand(options);
      return;
    }

    const suggestionOptions = suggestions.map((s) => ({
      value: s.index,
      label: s.message.length > 60 ? s.message.slice(0, 57) + "..." : s.message,
    }));

    const selectedIndex = await select({
      message: "Select a commit message:",
      options: suggestionOptions,
    });

    if (isCancel(selectedIndex)) {
      outro("Cancelled.");
      return;
    }

    const selected = suggestions.find((s) => s.index === selectedIndex);
    if (!selected) {
      outro(pc.red("Invalid selection."));
      return;
    }

    if (options.commit !== false) {
      await acceptAndCommit(selected, config, diffResult.diff);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    outro(pc.red(message));
  }
}

async function acceptAndCommit(
  selected: Suggestion,
  config: Config,
  diff: string,
  auto = false,
): Promise<void> {
  console.log(`\n  ${pc.green("Selected:")} ${pc.bold(selected.message)}`);
  if (selected.body) {
    console.log(`  ${pc.dim(selected.body)}`);
  }

  if (auto) {
    try {
      const result = commit(selected.message, selected.body);
      console.log(
        `${pc.green("✓ Commit created")} ${pc.bold(result.hash)} ${result.summary}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      outro(pc.red(`Commit failed: ${msg}`));
      process.exit(1);
    }

    try {
      await appendEntry({
        timestamp: new Date().toISOString(),
        message: selected.body
          ? `${selected.message}\n\n${selected.body}`
          : selected.message,
        diff,
        model: config.model,
        provider: config.provider,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      outro(pc.yellow(`Warning: failed to write history entry: ${msg}`));
    }

    outro(pc.green("Commit completed."));
    return;
  }

  const edit = await confirm({
    message: "Edit message before committing?",
    initialValue: false,
  });
  if (isCancel(edit)) {
    outro("Cancelled.");
    return;
  }

  let finalMessage = selected.message;
  let finalBody = selected.body;

  if (edit) {
    const editedMessage = await text({
      message: "Edit commit message:",
      initialValue: selected.message,
    });
    if (isCancel(editedMessage)) {
      outro("Cancelled.");
      return;
    }
    finalMessage = editedMessage;

    const editedBody = await text({
      message: "Edit body (optional):",
      initialValue: selected.body ?? "",
    });
    if (isCancel(editedBody)) {
      outro("Cancelled.");
      return;
    }
    finalBody = editedBody || undefined;
  }

  const confirmCommit = await confirm({
    message: "Commit with this message?",
    initialValue: true,
  });

  if (isCancel(confirmCommit) || !confirmCommit) {
    outro("Commit skipped.");
    return;
  }

  try {
    const result = commit(finalMessage, finalBody);
    console.log(
      `${pc.green("✓ Commit created")} ${pc.bold(result.hash)} ${result.summary}`,
    );

    await appendEntry({
      timestamp: new Date().toISOString(),
      message: finalBody ? `${finalMessage}\n\n${finalBody}` : finalMessage,
      diff,
      model: config.model,
      provider: config.provider,
    });

    outro(pc.green("Commit completed."));
  } catch (err) {
    outro(
      pc.red(
        `Commit failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      ),
    );
  }
}
