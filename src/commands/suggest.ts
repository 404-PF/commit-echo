import { intro, outro, select, text, confirm, spinner, isCancel } from '@clack/prompts';
import pc from 'picocolors';
import type { Config, Suggestion } from '../types.js';
import { loadOrPromptConfig } from '../config/store.js';
import { checkGitRepo, getStagedDiff, getUnstagedDiff, commit } from '../git/diff.js';
import { generateSuggestions } from '../llm/client.js';
import { buildSystemPrompt, buildUserPrompt } from '../llm/prompt.js';
import { appendEntry, buildProfile, formatProfile } from '../history/store.js';

interface SuggestOptions {
  commit?: boolean;
  autoCommit?: boolean;
  dryRun?: boolean;
}

async function displaySuggestions(suggestions: Suggestion[]): Promise<void> {
  for (const s of suggestions) {
    const full = s.body ? `${s.message}\n  ${pc.dim(s.body)}` : s.message;
    console.log(`  ${pc.cyan(`${s.index}.`)} ${full}`);
  }
}

export function formatDryRunOutput(diff: string, profileSummary: string, systemPrompt: string, userPrompt: string): string {
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
    pc.dim('None. The diff above will be sent in full.'),
  ].join('\n');
}

export async function suggestCommand(options: SuggestOptions = {}): Promise<void> {
  intro(pc.bold(pc.cyan('commit-echo')));

  try {
    checkGitRepo();
  } catch (err) {
    outro(pc.red(err instanceof Error ? err.message : 'Not a git repository.'));
    return;
  }

  let config: Config;
  try {
    config = await loadOrPromptConfig();
  } catch (err) {
    outro(pc.red(err instanceof Error ? err.message : 'Configuration error'));
    return;
  }

  let diffResult = getStagedDiff();

  if (!diffResult.hasChanges) {
    diffResult = getUnstagedDiff();
    if (!diffResult.hasChanges) {
      outro(pc.yellow('No changes detected. Stage your changes first with `git add`.'));
      return;
    }
  }

  const profile = await buildProfile(config.historySize);
  const profileStr = formatProfile(profile);
  if (profile.totalCommits > 0) {
    console.log(pc.dim(profileStr) + '\n');
  }

  if (options.dryRun) {
    console.log(formatDryRunOutput(
      diffResult.diff,
      profileStr,
      buildSystemPrompt(profile),
      buildUserPrompt(diffResult.diff)
    ));
    outro(pc.green('Dry run complete.'));
    return;
  }

  const genSpinner = spinner();
  genSpinner.start('Generating commit suggestions...');

  try {
    const { suggestions } = await generateSuggestions(config, diffResult.diff);
    genSpinner.stop(pc.green('Suggestions generated:'));

    await displaySuggestions(suggestions);

    if (options.autoCommit && suggestions.length > 0) {
      await acceptAndCommit(suggestions[0]!, config, diffResult.diff);
      return;
    }

    const action = await select({
      message: 'Choose an action:',
      options: [
        { value: 'select', label: 'Select a suggestion to commit' },
        { value: 'regenerate', label: 'Regenerate suggestions' },
        { value: 'cancel', label: 'Cancel' },
      ],
    });

    if (isCancel(action) || action === 'cancel') {
      outro('Cancelled.');
      return;
    }

    if (action === 'regenerate') {
      await suggestCommand(options);
      return;
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
      return;
    }

    const selected = suggestions.find((s) => s.index === selectedIndex);
    if (!selected) {
      outro(pc.red('Invalid selection.'));
      return;
    }

    if (options.commit !== false) {
      await acceptAndCommit(selected, config, diffResult.diff);
    }
  } catch (err) {
    genSpinner.stop(pc.red('Failed to generate suggestions.'));
    const message = err instanceof Error ? err.message : 'Unknown error';
    outro(pc.red(message));
  }
}

async function acceptAndCommit(selected: Suggestion, config: Config, diff: string): Promise<void> {
  console.log(`\n  ${pc.green('Selected:')} ${pc.bold(selected.message)}`);
  if (selected.body) {
    console.log(`  ${pc.dim(selected.body)}`);
  }

  const edit = await confirm({
    message: 'Edit message before committing?',
    initialValue: false,
  });
  if (isCancel(edit)) { outro('Cancelled.'); return; }

  let finalMessage = selected.message;
  let finalBody = selected.body;

  if (edit) {
    const editedMessage = await text({
      message: 'Edit commit message:',
      initialValue: selected.message,
    });
    if (isCancel(editedMessage)) { outro('Cancelled.'); return; }
    finalMessage = editedMessage;

    const editedBody = await text({
      message: 'Edit body (optional):',
      initialValue: selected.body ?? '',
    });
    if (isCancel(editedBody)) { outro('Cancelled.'); return; }
    finalBody = editedBody || undefined;
  }

  const confirmCommit = await confirm({
    message: 'Commit with this message?',
    initialValue: true,
  });

  if (isCancel(confirmCommit) || !confirmCommit) {
    outro('Commit skipped.');
    return;
  }

  try {
    const result = commit(finalMessage, finalBody);
    console.log(pc.green(result.trim()));

    await appendEntry({
      timestamp: new Date().toISOString(),
      message: finalBody ? `${finalMessage}\n\n${finalBody}` : finalMessage,
      diff,
      model: config.model,
      provider: config.provider,
    });

    outro(pc.green('✓ Commit created.'));
  } catch (err) {
    outro(pc.red(`Commit failed: ${err instanceof Error ? err.message : 'Unknown error'}`));
  }
}
