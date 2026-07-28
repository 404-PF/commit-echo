import { readFile, writeFile, appendFile, mkdir, open, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { CommitEntry, StyleProfile } from '../types.js';
import { getHistoryPath, getConfigDir } from '../config/store.js';

const CONVENTIONAL_PREFIX_RE = /^(feat|fix|chore|docs|style|refactor|perf|test|build|ci|revert)(\([^)]+\))?:\s*/;

const HISTORY_LOCK_RETRY_MS = 25;
const HISTORY_LOCK_TIMEOUT_MS = 10_000;
const HISTORY_LOCK_STALE_MS = 60_000;
const HISTORY_LOCK_TAKEOVER_SUFFIX = '.takeover';

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function waitForHistoryLockRetry(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, HISTORY_LOCK_RETRY_MS));
}

interface HistoryLockSnapshot {
  ownerToken: string;
  mtimeMs: number;
}

async function readHistoryLockSnapshot(lockPath: string): Promise<HistoryLockSnapshot> {
  const lock = await open(lockPath, 'r');
  try {
    const [ownerToken, lockStats] = await Promise.all([lock.readFile('utf-8'), lock.stat()]);
    return { ownerToken, mtimeMs: lockStats.mtimeMs };
  } finally {
    await lock.close();
  }
}

async function removeHistoryLock(lockPath: string, ownerToken: string): Promise<void> {
  try {
    const lockSnapshot = await readHistoryLockSnapshot(lockPath);
    if (lockSnapshot.ownerToken === ownerToken) {
      await unlink(lockPath);
    }
  } catch (error) {
    if (!hasErrorCode(error, 'ENOENT')) throw error;
  }
}

async function hasHistoryLockTakeover(lockPath: string): Promise<boolean> {
  const takeover = `${lockPath}${HISTORY_LOCK_TAKEOVER_SUFFIX}`;
  try {
    const lock = await open(takeover, 'r');
    await lock.close();
    return true;
  } catch (error) {
    if (!hasErrorCode(error, 'ENOENT')) throw error;
    return false;
  }
}

async function removeStaleHistoryLock(lockPath: string): Promise<void> {
  try {
    const lockSnapshot = await readHistoryLockSnapshot(lockPath);
    if (Date.now() - lockSnapshot.mtimeMs <= HISTORY_LOCK_STALE_MS) return;

    // Claim this stale lock generation with an exclusive marker. Other
    // waiters must leave the marker and lock alone until its claimant finishes.
    const takeoverPath = `${lockPath}${HISTORY_LOCK_TAKEOVER_SUFFIX}`;
    try {
      const takeover = await open(takeoverPath, 'wx', 0o600);
      await takeover.writeFile(lockSnapshot.ownerToken, 'utf-8');
      await takeover.close();
    } catch (error) {
      if (hasErrorCode(error, 'EEXIST')) return;
      if (!hasErrorCode(error, 'ENOENT')) throw error;
      return;
    }

    try {
      const currentSnapshot = await readHistoryLockSnapshot(lockPath);
      if (currentSnapshot.ownerToken === lockSnapshot.ownerToken) {
        await unlink(lockPath);
      }
    } catch (error) {
      if (!hasErrorCode(error, 'ENOENT')) throw error;
    } finally {
      try {
        await unlink(takeoverPath);
      } catch (error) {
        if (!hasErrorCode(error, 'ENOENT')) throw error;
      }
    }
  } catch (error) {
    if (!hasErrorCode(error, 'ENOENT')) throw error;
  }
}

async function acquireHistoryLock(historyPath: string): Promise<() => Promise<void>> {
  const lockPath = `${historyPath}.lock`;
  const deadline = Date.now() + HISTORY_LOCK_TIMEOUT_MS;

  while (true) {
    if (await hasHistoryLockTakeover(lockPath)) {
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting to update commit history: ${historyPath}`);
      }
      await waitForHistoryLockRetry();
      continue;
    }

    try {
      const lock = await open(lockPath, 'wx', 0o600);
      const ownerToken = randomUUID();
      await lock.writeFile(ownerToken, 'utf-8');
      await lock.close();

      return () => removeHistoryLock(lockPath, ownerToken);
    } catch (error) {
      if (!hasErrorCode(error, 'EEXIST')) throw error;

      await removeStaleHistoryLock(lockPath);
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting to update commit history: ${historyPath}`);
      }
      await waitForHistoryLockRetry();
    }
  }
}

/** Append one commit entry to the configured JSONL history file. */
export async function appendEntry(entry: CommitEntry): Promise<void> {
  const historyPath = getHistoryPath();
  const configDir = getConfigDir();
  if (!existsSync(configDir)) {
    await mkdir(configDir, { recursive: true });
  }

  const releaseHistoryLock = await acquireHistoryLock(historyPath);
  try {
    await appendFile(historyPath, JSON.stringify(entry) + '\n', 'utf-8');
  } finally {
    await releaseHistoryLock();
  }
}

/** Load recent valid history entries while warning once about corrupted JSONL rows. */
export async function loadEntries(limit = 200): Promise<CommitEntry[]> {
  const historyPath = getHistoryPath();
  if (!existsSync(historyPath)) return [];

  const raw = await readFile(historyPath, 'utf-8');
  const lines = raw
    .split('\n')
    .map((line, index) => ({ line, lineNumber: index + 1 }))
    .filter(({ line }) => line.trim().length > 0)
    .reverse();

  const entries: CommitEntry[] = [];
  const corruptedLineNumbers: number[] = [];

  for (const { line, lineNumber } of lines) {
    try {
      const entry = JSON.parse(line) as CommitEntry;
      if (entries.length < limit) {
        entries.push(entry);
      }
    } catch {
      corruptedLineNumbers.push(lineNumber);
    }
  }

  warnCorruptedHistory(historyPath, corruptedLineNumbers);

  return entries;
}

/** Emit a compact warning that identifies corrupted history line numbers. */
function warnCorruptedHistory(historyPath: string, corruptedLineNumbers: number[]): void {
  if (corruptedLineNumbers.length === 0) return;

  const count = corruptedLineNumbers.length;
  const noun = count === 1 ? 'entry' : 'entries';
  const lines = corruptedLineNumbers
    .slice(0, 5)
    .sort((a, b) => a - b)
    .join(', ');
  const suffix = count > 5 ? `, +${count - 5} more` : '';

  console.warn(
    `Warning: ignored ${count} corrupted commit history ${noun} in ${historyPath} (line ${lines}${suffix}).`,
  );
}

/** Count raw history rows in the configured history file. */
export async function countEntries(): Promise<number> {
  const historyPath = getHistoryPath();
  if (!existsSync(historyPath)) return 0;

  const raw = await readFile(historyPath, 'utf-8');
  return raw.split('\n').filter(Boolean).length;
}

/** Build a style profile from recent commit history entries. */
export async function buildProfile(historySize: number): Promise<StyleProfile> {
  const entries = await loadEntries(historySize);

  if (entries.length === 0) {
    return {
      avgLength: 0,
      commonPrefixes: [],
      prefixRates: {},
      imperativeRate: 0,
      sentenceCaseRate: 0,
      usesScopeRate: 0,
      usesBodyRate: 0,
      totalCommits: 0,
    };
  }

  const totalLengths: number[] = [];
  const prefixCounts: Record<string, number> = {};
  let imperativeCount = 0;
  let imperativeSampleCount = 0;
  let sentenceCaseCount = 0;
  let scopeCount = 0;
  let bodyCount = 0;

  for (const entry of entries) {
    const lines = entry.message.split('\n');
    const firstLine = lines[0];
    totalLengths.push(firstLine.length);

    const prefixMatch = firstLine.match(CONVENTIONAL_PREFIX_RE);
    if (prefixMatch) {
      const prefix = prefixMatch[1]!;
      prefixCounts[prefix] = (prefixCounts[prefix] ?? 0) + 1;

      if (prefixMatch[2]) {
        scopeCount++;
      }
    }

    if (lines.length > 1 && lines.slice(1).some((l) => l.trim().length > 0)) {
      bodyCount++;
    }

    const verbMatch = firstLine.match(
      /^(?:feat|fix|chore|docs|style|refactor|perf|test|build|ci|revert)(?:\([^)]+\))?:\s*(\w+)/,
    );
    if (verbMatch) {
      const verb = verbMatch[1]!;
      if (!verb.endsWith('ed') && !verb.endsWith('ing')) {
        imperativeCount++;
        imperativeSampleCount++;
      }
    } else {
      const firstWord = firstLine.match(/^\w+/);
      if (firstWord && !firstWord[0]!.endsWith('ed') && !firstWord[0]!.endsWith('ing')) {
        imperativeCount++;
        imperativeSampleCount++;
      }
    }

    if (/^[A-Z]/.test(firstLine)) {
      sentenceCaseCount++;
    }
  }

  const avgLength = Math.round(totalLengths.reduce((a, b) => a + b, 0) / totalLengths.length);

  const sortedPrefixes = Object.entries(prefixCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  const total = entries.length;

  return {
    avgLength,
    commonPrefixes: sortedPrefixes.map(([p]) => p),
    prefixRates: Object.fromEntries(sortedPrefixes.map(([p, c]) => [p, c / total])),
    imperativeRate: imperativeSampleCount > 0 ? imperativeCount / imperativeSampleCount : 0,
    sentenceCaseRate: sentenceCaseCount / total,
    usesScopeRate: scopeCount / total,
    usesBodyRate: bodyCount / total,
    totalCommits: total,
  };
}

/** Format a style profile for CLI display. */
export function formatProfile(profile: StyleProfile): string {
  if (profile.totalCommits === 0) {
    return 'No commit history yet. Suggestions will use default style.';
  }

  const lines: string[] = [
    `Analyzed ${profile.totalCommits} commit(s)`,
    `Average length: ${profile.avgLength} characters`,
    `Commit tone: ${profile.imperativeRate >= 0.5 ? 'Mostly imperative' : 'Mixed/descriptive'} (${Math.round(profile.imperativeRate * 100)}% imperative)`,
    `Capitalization: ${profile.sentenceCaseRate >= 0.5 ? 'Mostly sentence case' : 'Mixed'} (${Math.round(profile.sentenceCaseRate * 100)}% capitalized)`,
    `Scope usage: ${Math.round(profile.usesScopeRate * 100)}%`,
    `Body usage: ${Math.round(profile.usesBodyRate * 100)}%`,
  ];

  if (profile.commonPrefixes.length > 0) {
    const prefixes = profile.commonPrefixes
      .map((p) => `${p}: (${Math.round((profile.prefixRates[p] ?? 0) * 100)}%)`)
      .join(', ');
    lines.push(`Common prefixes: ${prefixes}`);
  } else {
    lines.push('No conventional commit prefixes detected');
  }

  return lines.join('\n');
}
