import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, copyFile, lstat, mkdir, readFile, readlink, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { CommitEntry, Config, Suggestion, StyleProfile } from '../types.js';
import { checkGitRepo, checkGitRepoWithSignal, getGitExecutable, getStagedDiffWithSignal } from './diff.js';
import type { DiffResult } from './diff.js';
import { loadConfig } from '../config/store.js';
import { appendEntry, buildProfile } from '../history/store.js';
import { generateSuggestions } from '../llm/client.js';

const MANAGED_HOOK_MARKER = '# commit-echo managed hook';
const PREPARE_COMMIT_MSG_HOOK_NAME = 'prepare-commit-msg';
const POST_COMMIT_HOOK_NAME = 'post-commit';
const PENDING_HOOK_ENTRY_FILE = 'commit-echo-pending-entry.json';
const BACKUP_OWNER_MARKER = '# commit-echo managed backup';
export const PREPARE_COMMIT_MSG_HOOK_TIMEOUT_MS = 5_000;

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
  checkGitRepo: (signal?: AbortSignal) => void | Promise<void>;
  loadConfig: () => Promise<Config>;
  getStagedDiff: (signal?: AbortSignal) => DiffResult | Promise<DiffResult>;
  buildProfile: (historySize: number) => Promise<StyleProfile>;
  generateSuggestions: typeof generateSuggestions;
  readMessageFile: (messageFile: string) => Promise<string>;
  writeMessageFile: (messageFile: string, content: string) => Promise<void>;
  writePendingEntryFile: (content: string) => Promise<void>;
  removePendingEntryFile: () => Promise<void>;
  warn: (message: string) => void;
  timeoutMs?: number;
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
    `if [ -f ${quotedCliPath} ]; then node ${quotedCliPath} hook ${quotedHookName} "$@"; elif command -v commit-echo >/dev/null 2>&1; then commit-echo hook ${quotedHookName} "$@"; fi`,
    '',
  ]