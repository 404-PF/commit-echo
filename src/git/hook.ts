import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { appendFile, copyFile, mkdir, chmod, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import type { CommitEntry, Config, Suggestion, StyleProfile } from '../types.js';
import { checkGitRepo, getStagedDiff } from './diff.js';
import type { DiffResult } from './diff.js';
import { loadConfig, getHistoryPath } from '../config/store.js';
import { buildProfile } from '../history/store.js';
import { generateSuggestions } from '../llm/client.js';

const MANAGED_HOOK_MARKER = '# commit-echo managed hook';
const PREPARE_COMMIT_MSG_HOOK_NAME = 'prepare-commit-msg';
const POST_COMMIT_HOOK_NAME = 'post-commit';
const PENDING_HOOK_ENTRY_FILE = 'commit-echo-pending-entry.json';

export interface PrepareCommitMsgHookArgs {
  messageFile: string;
  source?: string;
  sha?: string;
}

export interface PostCommitHookDeps {
  checkGitRepo: () => void;
  readLatestCommitMessage: () => string;
  readPendingEntryFile: () => Promise<string>;
  appendHistoryEntry: (entry: string) => Promise<void>;
  removePendingEntryFile: () => Promise<void>;
  warn: (message: string) => void;
}

export interface PrepareCommitMsgHookDeps {
  checkGitRepo: () => void;
  loadConfig: () => Promise<Config>;
  getStagedDiff: () => DiffResult;
  buildProfile: (historySize: number) => Promise<StyleProfile>;
  generateSuggestions: typeof generateSuggestions;
  readMessageFile: (messageFile: string) => Promise<string>;
  writeMessageFile: (messageFile: string, content: string) => Promise<void>;
  writePendingEntryFile: (content: string) => Promise<void>;
  removePendingEntryFile: () => Promise<void>;
  warn: (message: string) => void;
}

function resolveGitPath(gitPath: string): string {
  return execSync(`git rev-parse --git-path ${gitPath}`, { encoding: 'utf-8' }).trim();
}

function resolveHookPath(hookName: string): string {
  return resolveGitPath(`hooks/${hookName}`);
}

function resolvePendingEntryPath(): string {
  return resolveGitPath(PENDING_HOOK_ENTRY_FILE);
}

function buildManagedHookMarker(hookName: string): string {
  return `${MANAGED_HOOK_MARKER} ${hookName}`;
}

function toShellPath(value: string): string {
  return value.replace(/\\/g, '/');
}

function shellQuote(value: string): string {
  // POSIX-safe single-quote escaping: 'abc' -> 'abc', a'b -> 'a'"'"'b'
  return `'${toShellPath(value).replace(/'/g, `'"'"'`)}'`;
}

export function shouldSkipPrepareCommitMsgHook(source = ''): boolean {
  return source === 'message' || source === 'merge' || source === 'squash' || source === 'commit';
}

async function clearPendingEntryFile(removePendingEntryFile: () => Promise<void>): Promise<void> {
  try {
    await removePendingEntryFile();
  } catch {
    // Ignore cleanup errors in hook flows.
  }
}

export function buildHookCommitMessage(selected: Suggestion, existingContent = ''): string {
  const body = selected.body?.replace(/^\n+/, '') ?? '';
  const message = body ? `${selected.message}\n\n${body}` : selected.message;

  if (!existingContent) {
    return message;
  }

  return `${message}\n\n${existingContent}`;
}

function buildHookScript(hookName: string, cliPath: string, backupPath?: string): string {
  const quotedCliPath = shellQuote(cliPath);
  const quotedBackupPath = backupPath ? shellQuote(backupPath) : '';
  const quotedHookName = shellQuote(hookName);

  return [
    '#!/bin/sh',
    buildManagedHookMarker(hookName),
    quotedBackupPath
      ? `if [ -f ${quotedBackupPath} ]; then if [ -x ${quotedBackupPath} ]; then ${quotedBackupPath} "$@" || exit $?; else sh ${quotedBackupPath} "$@" || exit $?; fi; fi`
      : '',
    `if command -v commit-echo >/dev/null 2>&1; then commit-echo hook ${quotedHookName} "$@"; elif [ -f ${quotedCliPath} ]; then node ${quotedCliPath} hook ${quotedHookName} "$@"; fi`,
    '',
  ]
    .filter((line) => line.length > 0)
    .join('\n');
}

export function buildPrepareCommitMsgHookScript(cliPath: string, backupPath?: string): string {
  return buildHookScript(PREPARE_COMMIT_MSG_HOOK_NAME, cliPath, backupPath);
}

export function buildPostCommitHookScript(cliPath: string, backupPath?: string): string {
  return buildHookScript(POST_COMMIT_HOOK_NAME, cliPath, backupPath);
}

async function installManagedHook(hookName: string, cliPath: string): Promise<string> {
  const hookPath = resolveHookPath(hookName);
  const hookDir = dirname(hookPath);
  const backupPath = `${hookPath}.commit-echo.bak`;
  const marker = buildManagedHookMarker(hookName);

  await mkdir(hookDir, { recursive: true });

  if (existsSync(hookPath)) {
    const existingHook = await readFile(hookPath, 'utf-8').catch(() => '');
    if (!existingHook.includes(marker) && !existsSync(backupPath)) {
      await copyFile(hookPath, backupPath);
    }
  }

  const script = buildHookScript(hookName, cliPath, existsSync(backupPath) ? backupPath : undefined);
  await writeFile(hookPath, `${script}\n`, 'utf-8');
  await chmod(hookPath, 0o755);

  return hookPath;
}

export async function installPrepareCommitMsgHook(cliPath = process.argv[1] ?? 'dist/index.js'): Promise<string> {
  const resolvedCliPath = cliPath === process.argv[1]
    ? fileURLToPath(new URL('../index.js', import.meta.url))
    : cliPath;

  checkGitRepo();
  await installManagedHook(POST_COMMIT_HOOK_NAME, resolvedCliPath);
  return installManagedHook(PREPARE_COMMIT_MSG_HOOK_NAME, resolvedCliPath);
}

function buildPendingHookEntry(config: Config, diff: string): string {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    diff,
    model: config.model,
    provider: config.provider,
  });
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
    writePendingEntryFile: async (content) => writeFile(resolvePendingEntryPath(), content, 'utf-8'),
    removePendingEntryFile: async () => rm(resolvePendingEntryPath(), { force: true }),
    warn: (message) => console.warn(message),
  }
): Promise<void> {
  if (shouldSkipPrepareCommitMsgHook(args.source)) {
    await clearPendingEntryFile(deps.removePendingEntryFile);
    return;
  }

  try {
    deps.checkGitRepo();

    const config = await deps.loadConfig().catch(() => null);
    if (!config) {
      deps.warn('commit-echo hook: no configuration found; skipping.');
      await clearPendingEntryFile(deps.removePendingEntryFile);
      return;
    }

    const diffResult = deps.getStagedDiff();
    if (!diffResult.hasChanges) {
      await clearPendingEntryFile(deps.removePendingEntryFile);
      return;
    }

    const profile = await deps.buildProfile(config.historySize);
    const { suggestions } = await deps.generateSuggestions(config, diffResult.diff, profile);
    const selected = suggestions[0];
    if (!selected) {
      deps.warn('commit-echo hook: no suggestions were generated; leaving commit message unchanged.');
      await clearPendingEntryFile(deps.removePendingEntryFile);
      return;
    }

    const existingContent = await deps.readMessageFile(args.messageFile).catch(() => '');
    const nextContent = buildHookCommitMessage(selected, existingContent);
    await deps.writeMessageFile(args.messageFile, nextContent);
    await deps.writePendingEntryFile(buildPendingHookEntry(config, diffResult.diff));
  } catch (err) {
    await clearPendingEntryFile(deps.removePendingEntryFile);
    const message = err instanceof Error ? err.message : String(err);
    deps.warn(`commit-echo hook: ${message}`);
  }
}

export async function runPostCommitHook(
  deps: PostCommitHookDeps = {
    checkGitRepo,
    readLatestCommitMessage: () => execSync('git log -1 --pretty=%B', { encoding: 'utf-8' }).trim(),
    readPendingEntryFile: async () => readFile(resolvePendingEntryPath(), 'utf-8'),
    appendHistoryEntry: async (entry) => {
      await mkdir(dirname(getHistoryPath()), { recursive: true });
      await appendFile(getHistoryPath(), `${entry}\n`, 'utf-8');
    },
    removePendingEntryFile: async () => rm(resolvePendingEntryPath(), { force: true }),
    warn: (message) => console.warn(message),
  }
): Promise<void> {
  try {
    deps.checkGitRepo();

    const rawEntry = await deps.readPendingEntryFile().catch(() => '');
    if (!rawEntry) {
      return;
    }

    let pending: CommitEntry;
    try {
      pending = JSON.parse(rawEntry) as CommitEntry;
    } catch {
      deps.warn('commit-echo hook: invalid pending hook entry; clearing stale state.');
      await deps.removePendingEntryFile();
      return;
    }

    const message = deps.readLatestCommitMessage().trim();
    if (!message) {
      await deps.removePendingEntryFile();
      return;
    }

    const entry = JSON.stringify({
      timestamp: pending.timestamp,
      message,
      diff: pending.diff,
      model: pending.model,
      provider: pending.provider,
    });

    try {
      await deps.appendHistoryEntry(entry);
    } finally {
      await deps.removePendingEntryFile();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.warn(`commit-echo hook: ${message}`);
  }
}
