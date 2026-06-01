import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, chmod, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Config, Suggestion, StyleProfile } from '../types.js';
import { checkGitRepo, getStagedDiff } from './diff.js';
import type { DiffResult } from './diff.js';
import { loadConfig } from '../config/store.js';
import { buildProfile } from '../history/store.js';
import { generateSuggestions } from '../llm/client.js';

const HOOK_MARKER = '# commit-echo managed prepare-commit-msg hook';

export interface PrepareCommitMsgHookArgs {
  messageFile: string;
  source?: string;
  sha?: string;
}

export interface PrepareCommitMsgHookDeps {
  checkGitRepo: () => void;
  loadConfig: () => Promise<Config>;
  getStagedDiff: () => DiffResult;
  buildProfile: (historySize: number) => Promise<StyleProfile>;
  generateSuggestions: typeof generateSuggestions;
  readMessageFile: (messageFile: string) => Promise<string>;
  writeMessageFile: (messageFile: string, content: string) => Promise<void>;
  warn: (message: string) => void;
}

function resolvePrepareCommitMsgHookPath(): string {
  return execSync('git rev-parse --git-path hooks/prepare-commit-msg', { encoding: 'utf-8' }).trim();
}

function toShellPath(value: string): string {
  return value.replace(/\\/g, '/');
}

export function shouldSkipPrepareCommitMsgHook(source = ''): boolean {
  return source === 'message' || source === 'merge' || source === 'squash' || source === 'commit';
}

export function buildHookCommitMessage(selected: Suggestion, existingContent = ''): string {
  const message = selected.body ? `${selected.message}\n\n${selected.body}` : selected.message;
  const preservedComments = existingContent
    .split(/\r?\n/)
    .filter((line) => line.trim().length === 0 || line.trimStart().startsWith('#'))
    .join('\n')
    .trim();

  if (!preservedComments) {
    return message;
  }

  return `${message}\n\n${preservedComments}`;
}

export function buildPrepareCommitMsgHookScript(cliPath: string, backupPath?: string): string {
  const normalizedCliPath = toShellPath(cliPath);
  const normalizedBackupPath = backupPath ? toShellPath(backupPath) : '';

  return [
    '#!/bin/sh',
    HOOK_MARKER,
    normalizedBackupPath
      ? `if [ -f "${normalizedBackupPath}" ]; then if [ -x "${normalizedBackupPath}" ]; then "${normalizedBackupPath}" "$@" || exit $?; else sh "${normalizedBackupPath}" "$@" || exit $?; fi; fi`
      : '',
    `node "${normalizedCliPath}" hook "$@"`,
    '',
  ]
    .filter((line) => line.length > 0)
    .join('\n');
}

export async function installPrepareCommitMsgHook(cliPath = process.argv[1] ?? 'dist/index.js'): Promise<string> {
  checkGitRepo();

  const hookPath = resolvePrepareCommitMsgHookPath();
  const hookDir = dirname(hookPath);
  const backupPath = `${hookPath}.commit-echo.bak`;

  await mkdir(hookDir, { recursive: true });

  if (existsSync(hookPath)) {
    const existingHook = await readFile(hookPath, 'utf-8').catch(() => '');
    if (!existingHook.includes(HOOK_MARKER) && !existsSync(backupPath)) {
      await copyFile(hookPath, backupPath);
    }
  }

  const script = buildPrepareCommitMsgHookScript(cliPath, existsSync(backupPath) ? backupPath : undefined);
  await writeFile(hookPath, `${script}\n`, 'utf-8');
  await chmod(hookPath, 0o755);

  return hookPath;
}

export async function runPrepareCommitMsgHook(
  args: PrepareCommitMsgHookArgs,
  deps: PrepareCommitMsgHookDeps = {
    checkGitRepo,
    loadConfig,
    getStagedDiff,
    buildProfile,
    generateSuggestions,
    readMessageFile: async (messageFile) => readFile(messageFile, 'utf-8'),
    writeMessageFile: async (messageFile, content) => writeFile(messageFile, content, 'utf-8'),
    warn: (message) => console.warn(message),
  }
): Promise<void> {
  if (shouldSkipPrepareCommitMsgHook(args.source)) {
    return;
  }

  try {
    deps.checkGitRepo();

    const config = await deps.loadConfig().catch(() => null);
    if (!config) {
      deps.warn('commit-echo hook: no configuration found; skipping.');
      return;
    }

    const diffResult = deps.getStagedDiff();
    if (!diffResult.hasChanges) {
      return;
    }

    const profile = await deps.buildProfile(config.historySize);
    const { suggestions } = await deps.generateSuggestions(config, diffResult.diff, profile);
    const selected = suggestions[0];
    if (!selected) {
      deps.warn('commit-echo hook: no suggestions were generated; leaving commit message unchanged.');
      return;
    }

    const existingContent = await deps.readMessageFile(args.messageFile).catch(() => '');
    const nextContent = buildHookCommitMessage(selected, existingContent);
    await deps.writeMessageFile(args.messageFile, nextContent);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.warn(`commit-echo hook: ${message}`);
  }
}