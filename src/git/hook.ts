import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, copyFile, lstat, mkdir, readFile, readlink, rename, rm, symlink, writeFile } from 'node:fs/promises';
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
const BACKUP_OWNER_MARKER = '# commit-echo managed backup';

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
  unreadable: string[];
}

function resolveGitPath(gitPath: string): string {
  return execFileSync(getGitExecutable(), ['rev-parse', '--git-path', gitPath], { encoding: 'utf-8' }).trim();
}

function resolveHookPath(hookName: string): string {
  return resolveHookPaths(hookName).hookPath;
}

interface HookPaths {
  hookPath: string;
  backupPath: string;
  legacyBackupSuffix: string;
  ownerPath: string;
}

function resolveHookPaths(hookName: string): HookPaths {
  const gitHookPath = resolveGitPath(`hooks/${hookName}`);
  const hookPath = resolve(gitHookPath);
  const backupPath = `${hookPath}.commit-echo.bak`;

  return {
    hookPath,
    backupPath,
    // Older hooks embedded the raw git path, whose leading relative segments depended on cwd.
    legacyBackupSuffix: legacyPathSuffix(`${gitHookPath}.commit-echo.bak`),
    ownerPath: `${backupPath}.owner`,
  };
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

function legacyPathSuffix(value: string): string {
  const normalized = toShellPath(value).replace(/\/+/g, '/');
  const gitDirectoryIndex = normalized.lastIndexOf('/.git/');
  if (gitDirectoryIndex >= 0) {
    return normalized.slice(gitDirectoryIndex + 1);
  }
  const gitDirectoryStart = normalized.indexOf('.git/');
  if (gitDirectoryStart >= 0) {
    return normalized.slice(gitDirectoryStart);
  }
  const hooksDirectoryIndex = normalized.lastIndexOf('/hooks/');
  if (hooksDirectoryIndex >= 0) {
    return normalized.slice(hooksDirectoryIndex + 1);
  }
  return normalized.replace(/^(?:\.\.\/)+/, '');
}

function isManagedHookContent(hookName: string, content: string): boolean {
  const lines = content.split(/\r?\n/);
  return lines[0] === '#!/bin/sh' && lines[1] === buildManagedHookMarker(hookName);
}

function referencesBackupPath(content: string, backupPath: string, legacyBackupSuffix: string): boolean {
  if (content.includes(shellQuote(backupPath))) {
    return true;
  }

  const backupLine = content.split(/\r?\n/).find((line) => line.startsWith('if [ -f '));
  if (!backupLine) {
    return false;
  }

  const match = backupLine.match(/^if \[ -f '([^']+)' \];/);
  if (!match) {
    return false;
  }

  const referencedPath = toShellPath(match[1]).replace(/\/+/g, '/');
  return referencedPath === legacyBackupSuffix || referencedPath.endsWith(`/${legacyBackupSuffix}`);
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
  const stagedPath = `${backupPath}.tmp-${randomUUID()}`;

  if (hookStats.isSymbolicLink()) {
    try {
      await symlink(await readlink(hookPath, 'utf8'), stagedPath, 'file');
      await rename(stagedPath, backupPath);
    } catch (error) {
      await rm(stagedPath, { force: true }).catch(() => {});
      throw error;
    }
  } else {
    try {
      await copyFile(hookPath, stagedPath);
      await chmod(stagedPath, Number(hookStats.mode) & 0o7777);
      await rename(stagedPath, backupPath);
    } catch (error) {
      await rm(stagedPath, { force: true }).catch(() => {});
      throw error;
    }
  }
}

async function writeBackupOwner(ownerPath: string): Promise<void> {
  const stagedPath = `${ownerPath}.tmp-${randomUUID()}`;
  try {
    await writeFile(stagedPath, `${BACKUP_OWNER_MARKER}\n`, 'utf-8');
    await rename(stagedPath, ownerPath);
  } finally {
    await rm(stagedPath, { force: true }).catch(() => {});
  }
}

async function replacePreparedPath(preparedPath: string, targetPath: string): Promise<void> {
  const displacedPath = `${targetPath}.tmp-restore-${randomUUID()}`;
  const targetStats = await lstatIfExists(targetPath);
  let displaced = false;

  try {
    if (targetStats) {
      await rename(targetPath, displacedPath);
      displaced = true;
    }
    await rename(preparedPath, targetPath);
  } catch (error) {
    if (displaced) {
      await rename(displacedPath, targetPath).catch(() => {});
    }
    throw error;
  }

  if (displaced) {
    await rm(displacedPath, { force: true });
  }
}

async function restoreHookBackup(
  hookPath: string,
  backupPath: string,
  backupStats: Awaited<ReturnType<typeof lstat>>,
  ownerPath?: string,
): Promise<void> {
  if (!backupStats.isFile() && !backupStats.isSymbolicLink()) {
    throw new Error(`Refusing to restore non-regular hook backup at ${backupPath}`);
  }

  const stagedPath = `${hookPath}.tmp-restore-${randomUUID()}`;

  try {
    if (backupStats.isSymbolicLink()) {
      await symlink(await readlink(backupPath, 'utf8'), stagedPath, 'file');
    } else {
      await copyFile(backupPath, stagedPath);
      await chmod(stagedPath, Number(backupStats.mode) & 0o7777);
    }

    await replacePreparedPath(stagedPath, hookPath);
  } catch (error) {
    await rm(stagedPath, { force: true }).catch(() => {});
    throw error;
  }

  await rm(backupPath, { force: true });
  if (ownerPath) {
    await rm(ownerPath, { force: true });
  }
}

type PathSnapshot =
  | { kind: 'missing' }
  | { kind: 'file'; content: Buffer; mode: number }
  | { kind: 'symlink'; target: string };

async function snapshotPath(path: string): Promise<PathSnapshot> {
  const stats = await lstatIfExists(path);
  if (!stats) {
    return { kind: 'missing' };
  }
  if (stats.isSymbolicLink()) {
    return { kind: 'symlink', target: await readlink(path, 'utf8') };
  }
  if (!stats.isFile()) {
    throw new Error(`Expected a file or symlink at ${path}`);
  }
  return { kind: 'file', content: await readFile(path), mode: Number(stats.mode) & 0o7777 };
}

async function restoreSnapshot(path: string, snapshot: PathSnapshot): Promise<void> {
  if (snapshot.kind === 'missing') {
    await rm(path, { force: true });
    return;
  }

  const stagedPath = `${path}.tmp-rollback-${randomUUID()}`;
  try {
    if (snapshot.kind === 'symlink') {
      await symlink(snapshot.target, stagedPath, 'file');
    } else {
      await writeFile(stagedPath, snapshot.content);
      await chmod(stagedPath, snapshot.mode);
    }
    await replacePreparedPath(stagedPath, path);
  } finally {
    await rm(stagedPath, { force: true }).catch(() => {});
  }
}

interface InstalledHookChange {
  path: string;
  rollback: () => Promise<void>;
}

interface ManagedHookState {
  hookPath: string;
  backupPath: string;
  ownerPath: string;
  hookSnapshot: PathSnapshot;
  backupSnapshot: PathSnapshot;
  ownerSnapshot: PathSnapshot;
  isManagedHook: boolean;
  hasBackup: boolean;
  hasOwner: boolean;
  validOwner: boolean;
  referencesBackup: boolean;
}

async function inspectManagedHook(hookName: string): Promise<ManagedHookState> {
  const { hookPath, backupPath, legacyBackupSuffix, ownerPath } = resolveHookPaths(hookName);
  const hookSnapshot = await snapshotPath(hookPath);
  const backupSnapshot = await snapshotPath(backupPath);
  const ownerSnapshot = await snapshotPath(ownerPath);
  const existingHook = hookSnapshot.kind === 'file' ? hookSnapshot.content.toString('utf8') : '';
  const isManagedHook = hookSnapshot.kind === 'file' && isManagedHookContent(hookName, existingHook);

  return {
    hookPath,
    backupPath,
    ownerPath,
    hookSnapshot,
    backupSnapshot,
    ownerSnapshot,
    isManagedHook,
    hasBackup: backupSnapshot.kind !== 'missing',
    hasOwner: ownerSnapshot.kind !== 'missing',
    validOwner: ownerSnapshot.kind === 'file' && ownerSnapshot.content.toString('utf8').trim() === BACKUP_OWNER_MARKER,
    referencesBackup: isManagedHook && referencesBackupPath(existingHook, backupPath, legacyBackupSuffix),
  };
}

function validateManagedHookBackup(state: ManagedHookState): void {
  if (state.hasOwner && !state.validOwner) {
    throw new Error(
      `Refusing to use invalid backup ownership marker at ${state.ownerPath}; remove that file to reinstall the hook.`,
    );
  }
  if (state.hasBackup && !state.isManagedHook && !state.validOwner) {
    throw new Error(`Refusing to overwrite existing backup at ${state.backupPath}`);
  }
  if (state.hasBackup && state.isManagedHook && !state.referencesBackup && !state.validOwner) {
    throw new Error(`Refusing to use unowned backup at ${state.backupPath}`);
  }
}

async function prepareManagedHookBackup(state: ManagedHookState): Promise<void> {
  const isReplacement = state.hookSnapshot.kind !== 'missing' && !state.isManagedHook;
  if (isReplacement && state.validOwner) {
    await rm(state.backupPath, { force: true });
    await rm(state.ownerPath, { force: true });
  }

  const latestBackupStats = await lstatIfExists(state.backupPath);
  if (state.hookSnapshot.kind !== 'missing' && !state.isManagedHook && !latestBackupStats) {
    await backupHook(state.hookPath, state.backupPath, await lstat(state.hookPath));
    await writeBackupOwner(state.ownerPath);
  } else if (state.isManagedHook && latestBackupStats && state.referencesBackup && !state.validOwner) {
    // Adopt backups created by older commit-echo versions so future uninstall
    // operations can distinguish them from user-owned collision files.
    await writeBackupOwner(state.ownerPath);
  }
}

async function installManagedHook(hookName: string, cliPath: string): Promise<InstalledHookChange> {
  const state = await inspectManagedHook(hookName);
  await mkdir(dirname(state.hookPath), { recursive: true });
  validateManagedHookBackup(state);

  try {
    await prepareManagedHookBackup(state);

    const effectiveBackupStats = await lstatIfExists(state.backupPath);
    const script = buildHookScript(hookName, cliPath, effectiveBackupStats ? state.backupPath : undefined);
    const stagedPath = `${state.hookPath}.tmp-install-${randomUUID()}`;
    try {
      await writeFile(stagedPath, `${script}\n`, 'utf-8');
      await chmod(stagedPath, 0o755);
      await replacePreparedPath(stagedPath, state.hookPath);
    } finally {
      await rm(stagedPath, { force: true }).catch(() => {});
    }
  } catch (error) {
    await restoreSnapshot(state.ownerPath, state.ownerSnapshot).catch(() => {});
    await restoreSnapshot(state.backupPath, state.backupSnapshot).catch(() => {});
    await restoreSnapshot(state.hookPath, state.hookSnapshot).catch(() => {});
    throw error;
  }

  return {
    path: state.hookPath,
    rollback: async () => {
      await restoreSnapshot(state.ownerPath, state.ownerSnapshot);
      await restoreSnapshot(state.backupPath, state.backupSnapshot);
      await restoreSnapshot(state.hookPath, state.hookSnapshot);
    },
  };
}

type HookUninstallAction = 'restored' | 'removed' | 'skipped' | 'missing' | 'unreadable';

interface HookUninstallState {
  hookPath: string;
  backupPath: string;
  ownerPath: string;
  hookStats: Awaited<ReturnType<typeof lstat>> | null;
  backupStats: Awaited<ReturnType<typeof lstat>> | null;
  hookContent: string;
  isManagedHook: boolean;
  backupIsOwned: boolean;
}

async function inspectHookForUninstall(hookName: string, paths: HookPaths): Promise<HookUninstallState | null> {
  const { hookPath, backupPath, ownerPath } = paths;
  const hookStats = await lstatIfExists(hookPath);
  const backupStats = await lstatIfExists(backupPath);
  const ownerStats = await lstatIfExists(ownerPath);
  let isManagedHook = false;
  let hookContent = '';

  if (hookStats) {
    try {
      hookContent = await readFile(hookPath, 'utf-8');
      isManagedHook = isManagedHookContent(hookName, hookContent);
    } catch {
      return null;
    }
  }

  let ownerIsValid = false;
  if (ownerStats) {
    try {
      ownerIsValid =
        !ownerStats.isSymbolicLink() && (await readFile(ownerPath, 'utf-8')).trim() === BACKUP_OWNER_MARKER;
    } catch {
      return null;
    }
  }

  if (backupStats && !backupStats.isFile() && !backupStats.isSymbolicLink()) {
    return null;
  }

  const backupIsOwned = Boolean(
    backupStats &&
    (ownerIsValid || (isManagedHook && referencesBackupPath(hookContent, backupPath, paths.legacyBackupSuffix))),
  );

  return { hookPath, backupPath, ownerPath, hookStats, backupStats, hookContent, isManagedHook, backupIsOwned };
}

async function restoreOwnedHookBackup(state: HookUninstallState): Promise<'restored' | 'unreadable' | null> {
  const backupStats = state.backupStats;
  if (
    !backupStats ||
    !state.backupIsOwned ||
    // An existing non-managed path may be a user replacement even when empty.
    !(state.isManagedHook || !state.hookStats)
  ) {
    return null;
  }

  try {
    await restoreHookBackup(state.hookPath, state.backupPath, backupStats, state.ownerPath);
    return 'restored';
  } catch {
    return 'unreadable';
  }
}

async function uninstallManagedHook(hookName: string): Promise<{ path: string; action: HookUninstallAction }> {
  const paths = resolveHookPaths(hookName);
  const state = await inspectHookForUninstall(hookName, paths);
  const { hookPath } = paths;
  if (!state) {
    return { path: hookPath, action: 'unreadable' };
  }

  const restoreAction = await restoreOwnedHookBackup(state);
  if (restoreAction) {
    return { path: hookPath, action: restoreAction };
  }

  if (state.isManagedHook) {
    await rm(state.hookPath, { force: true });
    await rm(state.ownerPath, { force: true });
    return { path: hookPath, action: 'removed' };
  }

  if (state.backupStats && state.backupIsOwned) {
    await rm(state.backupPath, { force: true });
    await rm(state.ownerPath, { force: true });
  }

  return { path: hookPath, action: state.hookStats ? 'skipped' : 'missing' };
}

export async function installCommitHooks(cliPath = process.argv[1] ?? 'dist/index.js'): Promise<InstalledCommitHooks> {
  const resolvedCliPath =
    cliPath === process.argv[1] ? fileURLToPath(new URL('../index.js', import.meta.url)) : cliPath;

  checkGitRepo();
  let installed: InstalledHookChange[] = [];
  try {
    installed = [await installManagedHook(POST_COMMIT_HOOK_NAME, resolvedCliPath)];
    installed = [...installed, await installManagedHook(PREPARE_COMMIT_MSG_HOOK_NAME, resolvedCliPath)];
  } catch (error) {
    const rollbackOrder = [...installed];
    rollbackOrder.reverse();
    for (const change of rollbackOrder) {
      await change.rollback().catch(() => {});
    }
    throw error;
  }

  return { prepareCommitMsgPath: installed[1].path, postCommitPath: installed[0].path };
}

export async function installPrepareCommitMsgHook(cliPath = process.argv[1] ?? 'dist/index.js'): Promise<string> {
  const { prepareCommitMsgPath } = await installCommitHooks(cliPath);
  return prepareCommitMsgPath;
}

export async function uninstallCommitHooks(): Promise<UninstalledCommitHooks> {
  checkGitRepo();

  const results = [];
  for (const hookName of [PREPARE_COMMIT_MSG_HOOK_NAME, POST_COMMIT_HOOK_NAME]) {
    try {
      results.push(await uninstallManagedHook(hookName));
    } catch {
      results.push({ path: resolveHookPath(hookName), action: 'unreadable' as const });
    }
  }

  return {
    restored: results.filter((result) => result.action === 'restored').map((result) => result.path),
    removed: results.filter((result) => result.action === 'removed').map((result) => result.path),
    skipped: results.filter((result) => result.action === 'skipped').map((result) => result.path),
    missing: results.filter((result) => result.action === 'missing').map((result) => result.path),
    unreadable: results.filter((result) => result.action === 'unreadable').map((result) => result.path),
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
