import { existsSync, readdirSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { basename, join } from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { intro, outro, confirm, select, text, isCancel } from '@clack/prompts';
import pc from 'picocolors';
import { loadOrPromptConfig } from '../config/store.js';
import { assertApiKeyAvailable, generateSuggestions } from '../llm/client.js';
import { buildProfile, appendEntry } from '../history/store.js';
import { showVerboseInfo } from './suggest.js';
import type { Config, Suggestion, TruncationInfo } from '../types.js';

export interface BatchResult {
  repo: string;
  repoName: string;
  status: 'success' | 'skipped' | 'failed';
  message?: string;
}

/**
 * Scan a directory for git repositories (directories containing a `.git` folder).
 * When `recursive` is true, descends into subdirectories to find nested repos.
 */
export function findGitRepositories(rootDir: string, recursive: boolean): string[] {
  const repos: string[] = [];

  if (!existsSync(rootDir)) return repos;

  // If rootDir itself is a git repo, return it directly
  if (existsSync(join(rootDir, '.git'))) {
    repos.push(rootDir);
    return repos.sort();
  }

  let entries;
  try {
    entries = readdirSync(rootDir, { withFileTypes: true });
  } catch {
    return repos; // skip unreadable directories
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;

    const fullPath = join(rootDir, entry.name);

    if (existsSync(join(fullPath, '.git'))) {
      repos.push(fullPath);
    } else if (recursive) {
      repos.push(...findGitRepositories(fullPath, true));
    }
  }

  return repos.sort();
}

/**
 * Check whether a git repository at `cwd` has staged or unstaged changes.
 */
export function gitHasChanges(cwd: string): { staged: boolean; unstaged: boolean } {
  let staged = false;
  let unstaged = false;

  try {
    execSync('git diff --cached --quiet', { cwd, stdio: 'pipe' });
  } catch {
    staged = true;
  }

  try {
    execSync('git diff --quiet', { cwd, stdio: 'pipe' });
  } catch {
    unstaged = true;
  }

  return { staged, unstaged };
}

/**
 * Get the git diff for a repository at `cwd`.
 */
export function getGitDiff(cwd: string, staged: boolean): string {
  const cmd = staged ? 'git diff --cached' : 'git diff';
  try {
    return execSync(cmd, { cwd, encoding: 'utf-8', maxBuffer: 100 * 1024 * 1024 }).trim();
  } catch (err) {
    throw new Error(`Failed to get diff: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Run `git commit` inside a specific repository directory.
 */
export function gitCommit(cwd: string, message: string, body?: string): { hash: string; summary: string } {
  const fullMessage = body ? `${message}\n\n${body}` : message;
  const tmpFile = join(tmpdir(), `commit-echo-batch-${process.pid}-${Date.now()}.txt`);

  try {
    writeFileSync(tmpFile, fullMessage, 'utf-8');
    const result = spawnSync('git', ['commit', '-F', tmpFile], {
      cwd,
      encoding: 'utf-8',
      shell: false,
    });

    if (result.error) throw result.error;
    if (result.status !== 0) {
      const detail = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
      throw new Error(detail || `git commit exited with code ${result.status}`);
    }

    const summary = result.stdout.trim().split('\n').find(Boolean) ?? '';
    const match = summary.match(/\[.*?([a-f0-9]{7,})\]\s+(.+)$/i);

    return {
      hash: match?.[1] ?? '',
      summary: match?.[2] ?? summary,
    };
  } finally {
    try {
      unlinkSync(tmpFile);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Display a set of suggestions to the user.
 */
function displaySuggestions(suggestions: Suggestion[]): void {
  for (const s of suggestions) {
    const full = s.body ? `${s.message}\n      ${pc.dim(s.body)}` : s.message;
    console.log(`    ${pc.cyan(`${s.index}.`)} ${full}`);
  }
}

export async function batchCommand(
  options: {
    directory?: string;
    recursive?: boolean;
    verbose?: boolean;
    yes?: boolean;
  } = {},
): Promise<void> {
  intro(pc.bold(pc.cyan('commit-echo batch')));

  const dir = options.directory ?? process.cwd();

  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    outro(pc.red(`Directory not found: ${dir}`));
    return;
  }

  // Discover git repositories in the target directory
  const repos = findGitRepositories(dir, options.recursive ?? false);

  if (repos.length === 0) {
    outro(pc.yellow(`No git repositories found in ${dir}`));
    return;
  }

  console.log(`\n  Found ${pc.bold(String(repos.length))} repo(s) — checking for changes...\n`);

  // Load configuration once (shared across all repos)
  let config: Config;
  try {
    config = await loadOrPromptConfig();
  } catch (err) {
    outro(pc.red(err instanceof Error ? err.message : 'Configuration error'));
    return;
  }

  // Verify API key once
  let apiKey: string;
  try {
    apiKey = assertApiKeyAvailable(config);
  } catch (err) {
    outro(pc.red(err instanceof Error ? err.message : 'Missing API key'));
    return;
  }

  // Build style profile once (shared across all repos)
  const profile = await buildProfile(config.historySize);

  const results: BatchResult[] = [];

  for (const repoPath of repos) {
    const repoName = basename(repoPath);
    console.log(`  ${pc.bold(pc.cyan(`▶ ${repoName}`))}  ${pc.dim(repoPath)}`);

    // Check what kind of changes exist
    const { staged, unstaged } = gitHasChanges(repoPath);

    if (!staged) {
      if (!unstaged) {
        console.log(`    ${pc.yellow('↻ No changes found, skipping')}\n`);
        results.push({
          repo: repoPath,
          repoName,
          status: 'skipped',
          message: 'No changes',
        });
        continue;
      }
      console.log(`    ${pc.yellow('ℹ Unstaged changes only (stage with `git add` first), skipping')}\n`);
      results.push({
        repo: repoPath,
        repoName,
        status: 'skipped',
        message: 'Unstaged only',
      });
      continue;
    }

    // Get the staged diff
    let diff: string;
    try {
      diff = getGitDiff(repoPath, true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`    ${pc.red(`✖ ${msg}`)}\n`);
      results.push({ repo: repoPath, repoName, status: 'failed', message: msg });
      continue;
    }

    if (!diff) {
      console.log(`    ${pc.yellow('↻ Empty diff, skipping')}\n`);
      results.push({
        repo: repoPath,
        repoName,
        status: 'skipped',
        message: 'Empty diff',
      });
      continue;
    }

    // Generate suggestions using the shared profile
    let suggestions: Suggestion[];
    let truncation: TruncationInfo | undefined;
    let model: string;
    try {
      const result = await generateSuggestions(config, diff, profile, apiKey);
      suggestions = result.suggestions;
      model = result.model;
      truncation = result.truncation;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`    ${pc.red(`✖ Failed to generate suggestions: ${msg}`)}\n`);
      results.push({
        repo: repoPath,
        repoName,
        status: 'failed',
        message: msg,
      });
      continue;
    }

    if (options.verbose) {
      console.log('');
      showVerboseInfo(model, profile, truncation);
    }

    // Display suggestions
    console.log('');
    displaySuggestions(suggestions);

    if (options.yes) {
      // Unattended mode: auto-select first suggestion and commit
      const first = suggestions[0];
      if (!first) {
        console.log(`    ${pc.yellow('↻ No suggestions generated, skipping')}`);
        results.push({
          repo: repoPath,
          repoName,
          status: 'skipped',
          message: 'No suggestions',
        });
        console.log('');
        continue;
      }

      let commitResult: { hash: string; summary: string };
      try {
        commitResult = gitCommit(repoPath, first.message, first.body);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`    ${pc.red(`✖ Commit failed: ${msg}`)}`);
        results.push({
          repo: repoPath,
          repoName,
          status: 'failed',
          message: msg,
        });
        console.log('');
        continue;
      }

      try {
        await appendEntry({
          timestamp: new Date().toISOString(),
          message: first.body ? `${first.message}\n\n${first.body}` : first.message,
          diff,
          model: config.model,
          provider: config.provider,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(pc.yellow(`⚠ Commit succeeded (${commitResult.hash}) but failed to record in history: ${msg}`));
      }

      console.log(`    ${pc.green(`✓ ${pc.bold(commitResult.hash)} ${commitResult.summary}`)}`);
      results.push({
        repo: repoPath,
        repoName,
        status: 'success',
        message: first.message,
      });
    } else if (suggestions.length > 0) {
      // Interactive mode: prompt per repo
      const proceed = await confirm({
        message: `Commit changes in ${repoName}?`,
        initialValue: true,
      });

      if (isCancel(proceed)) {
        console.log(`    ${pc.dim('– Cancelled, skipping')}`);
        results.push({
          repo: repoPath,
          repoName,
          status: 'skipped',
          message: 'Cancelled',
        });
        console.log('');
        continue;
      }

      if (!proceed) {
        console.log(`    ${pc.dim('– Skipped')}`);
        results.push({
          repo: repoPath,
          repoName,
          status: 'skipped',
          message: 'User skipped',
        });
        console.log('');
        continue;
      }

      // Let user select which suggestion to use
      const suggestionOptions = suggestions.map((s) => ({
        value: s.index,
        label: s.message.length > 60 ? s.message.slice(0, 57) + '...' : s.message,
      }));

      const selectedIndex = await select({
        message: `Select message for ${repoName}:`,
        options: suggestionOptions,
      });

      if (isCancel(selectedIndex)) {
        console.log(`    ${pc.dim('– Cancelled, skipping')}`);
        results.push({
          repo: repoPath,
          repoName,
          status: 'skipped',
          message: 'Cancelled',
        });
        console.log('');
        continue;
      }

      const selected = suggestions.find((s) => s.index === selectedIndex);
      if (!selected) {
        console.log(`    ${pc.red('✖ Invalid selection')}`);
        results.push({
          repo: repoPath,
          repoName,
          status: 'failed',
          message: 'Invalid selection',
        });
        console.log('');
        continue;
      }

      // Prompt for an optional commit body (consistent with `suggest` UX)
      const customBody = await text({
        message: `Optional body for ${repoName}:`,
        initialValue: selected.body ?? '',
      });
      const finalBody = isCancel(customBody) || !customBody ? selected.body : customBody;

      let commitResult: { hash: string; summary: string };
      try {
        commitResult = gitCommit(repoPath, selected.message, finalBody);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`    ${pc.red(`✖ Commit failed: ${msg}`)}`);
        results.push({
          repo: repoPath,
          repoName,
          status: 'failed',
          message: msg,
        });
        console.log('');
        continue;
      }

      try {
        await appendEntry({
          timestamp: new Date().toISOString(),
          message: finalBody ? `${selected.message}\n\n${finalBody}` : selected.message,
          diff,
          model: config.model,
          provider: config.provider,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(pc.yellow(`⚠ Commit succeeded (${commitResult.hash}) but failed to record in history: ${msg}`));
      }

      console.log(`    ${pc.green(`✓ ${pc.bold(commitResult.hash)} ${commitResult.summary}`)}`);
      results.push({
        repo: repoPath,
        repoName,
        status: 'success',
        message: selected.message,
      });
    } else {
      console.log(`    ${pc.yellow('↻ No suggestions generated, skipping')}`);
      results.push({
        repo: repoPath,
        repoName,
        status: 'skipped',
        message: 'No suggestions',
      });
    }

    console.log('');
  }

  // Print summary report
  const succeeded = results.filter((r) => r.status === 'success');
  const failed = results.filter((r) => r.status === 'failed');
  const skipped = results.filter((r) => r.status === 'skipped');

  console.log(pc.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(pc.bold('📋  Batch Summary\n'));

  for (const r of results) {
    const icon = r.status === 'success' ? pc.green('✓') : r.status === 'failed' ? pc.red('✖') : pc.yellow('–');
    const msg = r.message ? ` — ${r.message.length > 60 ? r.message.slice(0, 57) + '...' : r.message}` : '';
    console.log(`  ${icon} ${r.repoName}${pc.dim(msg)}`);
  }

  console.log(
    `\n  ${pc.green(String(succeeded.length))} succeeded, ${pc.yellow(String(skipped.length))} skipped, ${pc.red(String(failed.length))} failed`,
  );
  outro('Batch processing complete.');
}
