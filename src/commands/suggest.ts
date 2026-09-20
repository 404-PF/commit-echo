import { intro, outro, select, text, confirm, spinner, isCancel } from '@clack/prompts';

import pc from 'picocolors';

import type { Config, Provider, StyleProfile, Suggestion, TruncationInfo } from '../types.js';

import { loadOrPromptConfig } from '../config/store.js';

import {
  checkGitRepo,
  hasCommits,
  getStagedDiff,
  getUnstagedDiff,
  getBranchName,
  getLastCommitMessage,
  commit,
  type DiffResult,
} from '../git/diff.js';

import { assertApiKeyAvailable, generateSuggestions, generateSuggestionsStream } from '../llm/client.js';

import { parseSuggestions, resolvePrompts, truncateDiff } from '../llm/prompt.js';

import { appendEntry, buildProfile, formatProfile } from '../history/store.js';

import { getStreamingProvider } from '../providers/index.js';

function showTruncationWarning(info: TruncationInfo): void {
  const pct = ((info.truncatedSize / info.originalSize) * 100).toFixed(1);
  console.warn(
    pc.yellow(
      `\n⚠  Diff truncated: ${info.originalSize} → ${info.truncatedSize} chars (${pct}%) ` +
        `— ${info.filesTruncated} file(s) affected. ` +
        `Adjust maxDiffSize in config or increase the --max-diff-size value.`,
    ),
  );
}

export function showVerboseInfo(model: string, profile: StyleProfile, truncation?: TruncationInfo): void {
  const commonPrefixes = profile.commonPrefixes.length > 0 ? profile.commonPrefixes.join(', ') : 'none';

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
        : 'Truncation: not applied',
    ),
  );
}

export function formatDryRunOutput(
  diff: string,
  profileSummary: string,
  systemPrompt: string,
  userPrompt: string,
  truncation?: TruncationInfo,
): string {
  return [
    pc.yellow('Dry run: no LLM API call will be made.'),
    '',
    pc.bold('Diff:'),
    pc.dim(diff),
    '',
    pc.bold('Style profile:'),
    pc.dim(profileSummary),
    '',
    pc.bold('System prompt:'),
    pc.dim(systemPrompt),
    '',
    pc.bold('User prompt:'),
    pc.dim(userPrompt),
    '',
    pc.bold('Truncation:'),
    pc.dim(
      truncation
        ? `${truncation.originalSize} -> ${truncation.truncatedSize} chars across ${truncation.filesTruncated} file(s)`
        : 'None. The diff above will be sent in full.',
    ),
  ].join('\n');
}

async function displaySuggestions(suggestions: Suggestion[]): Promise<void> {
  for (const s of suggestions) {
    const full = s.body ? `${s.message}\n  ${pc.dim(s.body)}` : s.message;
    console.log(`  ${pc.cyan(`${s.index}.`)} ${full}`);
  }
}

function normalizeDiff(diff: string): string {
  const normalized = diff.replace(/\r\n?/g, '\n');
  const sections = normalized.split(/(?=^diff --git )/m);

  if (sections.length === 1) {
    return normalized;
  }

  const prefix = sections[0]?.startsWith('diff --git ') ? '' : (sections.shift() ?? '');
  const sortedSections = sections.map((section) => removeTrailingLineBreaks(section)).sort(compareDiffSections);

  return prefix + sortedSections.join('\n');
}

function removeTrailingLineBreaks(section: string): string {
  let end = section.length;
  while (end > 0 && section.charCodeAt(end - 1) === 10) {
    end -= 1;
  }
  return section.slice(0, end);
}

function compareDiffSections(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

export function verifyStagedDiff(analyzedDiff: string, currentDiff: DiffResult): string | undefined {
  if (
    !currentDiff.staged ||
    !currentDiff.hasChanges ||
    normalizeDiff(currentDiff.diff) !== normalizeDiff(analyzedDiff)
  ) {
    return undefined;
  }
  return currentDiff.diff;
}

function getVerifiedStagedDiff(analyzedDiff: string): string | undefined {
  return verifyStagedDiff(analyzedDiff, getStagedDiff());
}

function verifyStagedDiffBeforeCommit(analyzedDiff: string): string | undefined {
  const verifiedDiff = getVerifiedStagedDiff(analyzedDiff);
  if (verifiedDiff) {
    return verifiedDiff;
  }

  outro(
    pc.red(
      'Staged changes are empty or changed since suggestions were generated. ' +
        'Stage the analyzed changes again before committing.',
    ),
  );
  process.exitCode = 1;
  return undefined;
}

export async function suggestCommand(
  options: {
    commit?: boolean;
    autoCommit?: boolean;
    verbose?: boolean;
    showDiff?: boolean;
    model?: string;
    maxDiffSize?: string;
    stream?: boolean;
    dryRun?: boolean;
    noCommit?: boolean;
  } = {},
): Promise<boolean> {
  intro(pc.bold(pc.cyan('commit-echo')));

  const shouldCommit = options.commit === true;

  if (options.noCommit) {
    console.warn(pc.yellow("Note: --no-commit is deprecated; 'commit-echo suggest' already skips committing."));
  }

  try {
    checkGitRepo();
  } catch (err) {
    outro(pc.red(err instanceof Error ? err.message : 'Not a git repository.'));
    return false;
  }

  if (!hasCommits()) {
    outro(
      pc.yellow('This repository has no commits yet. commit-echo needs at least one commit to analyze your style.'),
    );
    return true;
  }

  let config: Config;
  try {
    config = await loadOrPromptConfig();
  } catch (err) {
    outro(pc.red(err instanceof Error ? err.message : 'Configuration error'));
    return false;
  }

  if (options.model) {
    config.model = options.model;
  }

  if (options.maxDiffSize) {
    const parsed = Number(options.maxDiffSize);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      outro(pc.red('Invalid --max-diff-size value. Expected a positive integer.'));
      process.exitCode = 1;
      return false;
    }
    config.maxDiffSize = parsed;
  }

  let diffResult: DiffResult;

  try {
    diffResult = getStagedDiff();

    if (!diffResult.hasChanges) {
      const unstagedDiff = getUnstagedDiff();
      if (!unstagedDiff.hasChanges) {
        outro(pc.yellow('No changes detected in your working directory.'));
        return true;
      }

      if (!options.autoCommit) {
        let useUnstaged: boolean | symbol;
        try {
          useUnstaged = await confirm({
            message: 'No staged changes found. Use unstaged changes for suggestions?',
            initialValue: false,
          });
        } catch {
          outro(pc.yellow('Cancelled. Stage changes with `git add` and try again.'));
          return true;
        }

        if (isCancel(useUnstaged) || !useUnstaged) {
          outro(pc.yellow('Cancelled. Stage changes with `git add` and try again.'));
          return true;
        }
      }

      diffResult = unstagedDiff;
    }
  } catch (err) {
    outro(pc.red(`Failed to read git diff: ${err instanceof Error ? err.message : String(err)}`));
    return false;
  }

  const profile = await buildProfile(config.historySize);
  const needsPreview = options.dryRun || options.showDiff;
  const preview = needsPreview ? truncateDiff(diffResult.diff, config.maxDiffSize) : undefined;
  const getPreview = () => {
    if (!preview) {
      throw new Error('diff preview requested without dry-run or show-diff');
    }
    return preview;
  };

  if (options.dryRun) {
    const { diff: truncatedDiff, info: truncation } = getPreview();
    const vars = {
      diff: truncatedDiff,
      profile: formatProfile(profile),
      branch: getBranchName(),
      message: getLastCommitMessage(),
    };

    let sysPrompt = '';
    let usrPrompt = '';
    try {
      [sysPrompt, usrPrompt] = await resolvePrompts(profile, vars, config);
    } catch (err) {
      outro(pc.red(`Failed to load template: ${err instanceof Error ? err.message : String(err)}`));
      return false;
    }

    console.log(
      formatDryRunOutput(
        truncatedDiff,
        vars.profile,
        sysPrompt,
        usrPrompt,
        truncation.wasTruncated ? truncation : undefined,
      ),
    );
    outro(pc.green('Dry run complete.'));
    return true;
  }

  if (options.showDiff) {
    const { diff: truncatedDiff, info: truncation } = getPreview();
    console.log(pc.bold('Diff being analyzed:'));
    console.log(pc.dim(truncatedDiff));
    console.log('');
    if (truncation.wasTruncated) {
      console.log(pc.dim('The diff above is truncated to match maxDiffSize.'));
      console.log('');
    }
  }

  let apiKey: string;
  try {
    apiKey = assertApiKeyAvailable(config);
  } catch (err) {
    outro(pc.red(err instanceof Error ? err.message : 'Missing API key'));
    return false;
  }
  while (true) {
    let suggestions: Suggestion[];
    let generatedTruncation: TruncationInfo | undefined;
    let model: string;

    if (options.stream) {
      let streamProvider: Provider;
      try {
        streamProvider = getStreamingProvider(config.provider);
      } catch (err) {
        outro(pc.red(err instanceof Error ? err.message : 'Streaming not supported'));
        return false;
      }

      console.log(pc.dim('Streaming suggestions...\n'));

      model = config.model;
      let accumulated = '';
      let streamedReasoning = '';
      let hasVisibleContent = false;
      try {
        for await (const event of generateSuggestionsStream(config, diffResult.diff, profile, apiKey, streamProvider)) {
          if (event.kind === 'meta') {
            generatedTruncation = event.truncation;
            continue;
          }

          if (event.kind === 'model') {
            model = event.model;
            continue;
          }

          if (event.kind === 'reasoning') {
            if (!hasVisibleContent) {
              streamedReasoning += event.text;
              process.stdout.write(event.text);
            }
            continue;
          }

          hasVisibleContent = true;
          streamedReasoning = '';
          accumulated += event.text;
          process.stdout.write(event.text);
        }
      } catch (err) {
        process.stdout.write('\n');
        const message = err instanceof Error ? err.message : 'Unknown error';
        outro(pc.red(`Streaming failed: ${message}`));
        return false;
      }
      if (!hasVisibleContent) {
        accumulated = streamedReasoning;
      }
      process.stdout.write('\n\n');

      const parsed = parseSuggestions(accumulated);
      suggestions = parsed.map((p, i) => ({
        index: i + 1,
        message: p.message,
        body: p.body,
      }));

      if (suggestions.length === 0) {
        outro(
          pc.red('Could not parse any suggestions from LLM response. The model may need a different prompt format.'),
        );
        return false;
      }
    } else {
      const genSpinner = spinner();
      genSpinner.start('Generating commit suggestions...');

      try {
        const result = await generateSuggestions(config, diffResult.diff, profile, apiKey);
        suggestions = result.suggestions;
        generatedTruncation = result.truncation;
        model = result.model;
        genSpinner.stop(pc.green('Suggestions generated:'));
      } catch (err) {
        genSpinner.stop(pc.red('Failed to generate suggestions.'));
        const message = err instanceof Error ? err.message : 'Unknown error';
        outro(pc.red(message));
        return false;
      }
    }

    if (options.verbose) {
      showVerboseInfo(model, profile, generatedTruncation);
    }

    if (generatedTruncation) {
      showTruncationWarning(generatedTruncation);
    }

    if (!options.stream) {
      await displaySuggestions(suggestions);
    }

    if (options.autoCommit && suggestions.length > 0) {
      const first = suggestions[0]!;
      if (shouldCommit) {
        return acceptAndCommit(first, config, diffResult.diff, true);
      } else {
        console.log(`\n  ${pc.green('Selected:')} ${pc.bold(first.message)}`);
        if (first.body) {
          console.log(`  ${pc.dim(first.body)}`);
        }
      }
      return true;
    }

    try {
      const action = await select({
        message: 'Choose an action:',
        options: [
          { value: 'select', label: shouldCommit ? 'Select a suggestion to commit' : 'Select a suggestion' },
          { value: 'regenerate', label: 'Regenerate suggestions' },
          { value: 'cancel', label: 'Cancel' },
        ],
      });

      if (isCancel(action) || action === 'cancel') {
        outro('Cancelled.');
        return true;
      }

      if (action === 'regenerate') {
        continue;
      }

      const suggestionOptions = suggestions.map((s) => ({
        value: s.index,
        label: s.message.length > 60 ? s.message.slice(0, 57) + '...' : s.message,
      }));

      const selectedIndex = await select({
        message: 'Select a commit message:',
        options: suggestionOptions,
      });

      if (isCancel(selectedIndex)) {
        outro('Cancelled.');
        return true;
      }

      const selected = suggestions.find((s) => s.index === selectedIndex);
      if (!selected) {
        outro(pc.red('Invalid selection.'));
        return false;
      }

      if (shouldCommit) {
        return acceptAndCommit(selected, config, diffResult.diff);
      } else {
        console.log(`\n  ${pc.green('Selected:')} ${pc.bold(selected.message)}`);
        if (selected.body) {
          console.log(`  ${pc.dim(selected.body)}`);
        }
      }
      break;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      outro(pc.red(message));
      return false;
    }
  }

  return true;
}

async function acceptAndCommit(selected: Suggestion, config: Config, diff: string, auto = false): Promise<boolean> {
  console.log(`\n  ${pc.green('Selected:')} ${pc.bold(selected.message)}`);
  if (selected.body) {
    console.log(`  ${pc.dim(selected.body)}`);
  }

  if (auto) {
    const verifiedDiff = verifyStagedDiffBeforeCommit(diff);
    if (!verifiedDiff) {
      return false;
    }

    try {
      const result = commit(selected.message, selected.body);
      console.log(`${pc.green('✓ Commit created')} ${pc.bold(result.hash)} ${result.summary}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      outro(pc.red(`Commit failed: ${msg}`));
      process.exitCode = 1;
      return false;
    }

    try {
      await appendEntry({
        timestamp: new Date().toISOString(),
        message: selected.body ? `${selected.message}\n\n${selected.body}` : selected.message,
        diff: verifiedDiff,
        model: config.model,
        provider: config.provider,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(pc.yellow(`⚠ Commit succeeded but failed to record in history: ${msg}`));
    }

    outro(pc.green('Commit completed.'));
    return true;
  }

  const edit = await confirm({
    message: 'Edit message before committing?',
    initialValue: false,
  });
  if (isCancel(edit)) {
    outro('Cancelled.');
    return true;
  }

  let finalMessage = selected.message;
  let finalBody = selected.body;

  if (edit) {
    const editedMessage = await text({
      message: 'Edit commit message:',
      initialValue: selected.message,
    });
    if (isCancel(editedMessage)) {
      outro('Cancelled.');
      return true;
    }
    finalMessage = editedMessage;

    const editedBody = await text({
      message: 'Edit body (optional):',
      initialValue: selected.body ?? '',
    });
    if (isCancel(editedBody)) {
      outro('Cancelled.');
      return true;
    }
    finalBody = editedBody || undefined;
  }

  const confirmCommit = await confirm({
    message: 'Commit with this message?',
    initialValue: true,
  });

  if (isCancel(confirmCommit) || !confirmCommit) {
    outro('Commit skipped.');
    return true;
  }

  const verifiedDiff = verifyStagedDiffBeforeCommit(diff);
  if (!verifiedDiff) {
    return false;
  }

  let result;

  try {
    result = commit(finalMessage, finalBody);
    console.log(`${pc.green('✓ Commit created')} ${pc.bold(result.hash)} ${result.summary}`);
  } catch (err) {
    outro(pc.red(`Commit failed: ${err instanceof Error ? err.message : 'Unknown error'}`));
    process.exitCode = 1;
    return false;
  }

  try {
    await appendEntry({
      timestamp: new Date().toISOString(),
      message: finalBody ? `${finalMessage}\n\n${finalBody}` : finalMessage,
      diff: verifiedDiff,
      model: config.model,
      provider: config.provider,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(pc.yellow(`⚠ Commit succeeded but failed to record in history: ${msg}`));
  }

  outro(pc.green('Commit completed.'));
  return true;
}
