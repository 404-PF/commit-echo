import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, chmod, lstat, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { CommitEntry, Config, Suggestion, StyleProfile } from '../types.js';
import { checkGitRepo, getGitExecutable, getStagedDiff } from './diff.js';
import type { DiffResult } from './diff.js';
import { loadConfig } from '../config/store.js';
import { appendEntry, buildProfile } from '../history/store.js';
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
  appendHistoryEntry: (entry: CommitEntry) => Promise<void>;
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

export interface InstalledCommitHooks {
  prepareCommitMsgPath: string;
  postCommitPath: string;
}

export interface UninstalledCommitHooks {
  restored: string[];
  removed: string[];
  skipped: string[];
  missing: string[];
}

function resolveGitPath(gitPath: string): string {
  return execFileSync(getGitExecutable(), ['rev-parse', '--git-path', gitPath], { encoding: 'utf-8' }).trim();
}

function resolveHookPath(hookName: string): string {
  return resolve(resolveGitPath(`hooks/${hookName}`));
}

function resolvePendingEntryPath(): string {
  return resolveGitPath(PENDING_HOOK_ENTRY_FILE);
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

async function lstatIfExists(path: string): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  try {
    return await lstat(path);
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
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

async function backupHook(
  hookPath: string,
  backupPath: string,
  hookStats: Awaited<ReturnType<typeof lstat>>,
): Promise<void> {
  if (hookStats.isSymbolicLink()) {
    await symlink(await readlink(hookPath, 'utf8'), backupPath, 'file');
    return;
  }

  await copyFile(hookPath, backupPath);
  await chmod(backupPath, Number(hookStats.mode) & 0o7777);
}

async function restoreHookBackup(
  hookPath: string,
  backupPath: string,
  backupStats: Awaited<ReturnType<typeof lstat>>,
): Promise<void> {
  await rm(hookPath, { force: true });

  if (backupStats.isSymbolicLink()) {
    await symlink(await readlink(backupPath, 'utf8'), hookPath, 'file');
  } else {
    await copyFile(backupPath, hookPath);
    await chmod(hookPath, Number(backupStats.mode) & 0o7777);
  }

  await rm(backupPath, { force: true });
}

async function installManagedHook(hookName: string, cliPath: string): Promise<string> {
  const hookPath = resolveHookPath(hookName);
  const hookDir = dirname(hookPath);
  const backupPath = `${hookPath}.commit-echo.bak`;
  const marker = buildManagedHookMarker(hookName);

  await mkdir(hookDir, { recursive: true });

  const hookStats = await lstatIfExists(hookPath);
  const backupStats = await lstatIfExists(backupPath);
  if (hookStats) {
    const existingHook = hookStats.isSymbolicLink() ? '' : await readFile(hookPath, 'utf-8').catch(() => '');
    if ((!existingHook.includes(marker) || hookStats.isSymbolicLink()) && !backupStats) {
      await backupHook(hookPath, backupPath, hookStats);
    }
  }

  const latestBackupStats = await lstatIfExists(backupPath);
  const script = buildHookScript(hookName, cliPath, latestBackupStats ? backupPath : undefined);
  if (hookStats?.isSymbolicLink()) {
    await rm(hookPath, { force: true });
  }
  await writeFile(hookPath, `${script}\n`, 'utf-8');
  await chmod(hookPath, 0o755);

  return hookPath;
}

type HookUninstallAction = 'restored' | 'removed' | 'skipped' | 'missing';

async function uninstallManagedHook(hookName: string): Promise<{ path: string; action: HookUninstallAction }> {
  const hookPath = resolveHookPath(hookName);
  const backupPath = `${hookPath}.commit-echo.bak`;
  const marker = buildManagedHookMarker(hookName);
  const hookStats = await lstatIfExists(hookPath);
  const backupStats = await lstatIfExists(backupPath);
  let isManagedHook = false;
  let hookReadFailed = false;

  if (hookStats) {
    try {
      isManagedHook = (await readFile(hookPath, 'utf-8')).includes(marker);
    } catch {
      hookReadFailed = true;
    }
  }

  if (backupStats && (isManagedHook || !hookStats || hookReadFailed)) {
    await restoreHookBackup(hookPath, backupPath, backupStats);
    return { path: hookPath, action: 'restored' };
  }

  if (isManagedHook) {
    await rm(hookPath, { force: true });
    return { path: hookPath, action: 'removed' };
  }

  if (backupStats) {
    await rm(backupPath, { force: true });
  }

  return { path: hookPath, action: hookStats ? 'skipped' : 'missing' };
}

export async function installCommitHooks(cliPath = process.argv[1] ?? 'dist/index.js'): Promise<InstalledCommitHooks> {
  const resolvedCliPath =
    cliPath === process.argv[1] ? fileURLToPath(new URL('../index.js', import.meta.url)) : cliPath;

  checkGitRepo();
  const postCommitPath = await installManagedHook(POST_COMMIT_HOOK_NAME, resolvedCliPath);
  const prepareCommitMsgPath = await installManagedHook(PREPARE_COMMIT_MSG_HOOK_NAME, resolvedCliPath);

  return { prepareCommitMsgPath, postCommitPath };
}

export async function installPrepareCommitMsgHook(cliPath = process.argv[1] ?? 'dist/index.js'): Promise<string> {
  const { prepareCommitMsgPath } = await installCommitHooks(cliPath);
  return prepareCommitMsgPath;
}

export async function uninstallCommitHooks(): Promise<UninstalledCommitHooks> {
  checkGitRepo();

  const results = [
    await uninstallManagedHook(PREPARE_COMMIT_MSG_HOOK_NAME),
    await uninstallManagedHook(POST_COMMIT_HOOK_NAME),
  ];

  return {
    restored: results.filter((result) => result.action === 'restored').map((result) => result.path),
    removed: results.filter((result) => result.action === 'removed').map((result) => result.path),
    skipped: results.filter((result) => result.action === 'skipped').map((result) => result.path),
    missing: results.filter((result) => result.action === 'missing').map((result) => result.path),
  };
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
  },
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
    readLatestCommitMessage: () =>
      execFileSync(getGitExecutable(), ['log', '-1', '--pretty=%B'], { encoding: 'utf-8' }).trim(),
    readPendingEntryFile: async () => readFile(resolvePendingEntryPath(), 'utf-8'),
    appendHistoryEntry: appendEntry,
    removePendingEntryFile: async () => rm(resolvePendingEntryPath(), { force: true }),
    warn: (message) => console.warn(message),
  },
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

    const entry: CommitEntry = {
      timestamp: pending.timestamp,
      message,
      diff: pending.diff,
      model: pending.model,
      provider: pending.provider,
    };

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
