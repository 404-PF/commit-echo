import { readFile, writeFile, appendFile, mkdir, open, unlink, rename } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { CommitEntry, StyleProfile } from '../types.js';
import { getHistoryPath, getConfigDir } from '../config/store.js';

const CONVENTIONAL_PREFIX_RE = /^(feat|fix|chore|docs|style|refactor|perf|test|build|ci|revert)(\([^)]+\))?:\s*/;

const HISTORY_LOCK_RETRY_MS = 25;
const HISTORY_LOCK_STALE_MS = 60_000;
const HISTORY_LOCK_TIMEOUT_MS = HISTORY_LOCK_STALE_MS + 10_000;
const HISTORY_LOCK_HEARTBEAT_MS = 15_000;
const HISTORY_LOCK_TAKEOVER_SUFFIX = '.takeover';
const HISTORY_READ_CHUNK_SIZE = 64 * 1024;

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function waitForHistoryLockRetry(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, HISTORY_LOCK_RETRY_MS));
}

function maintainHistoryLockLease(lock: FileHandle): () => Promise<void> {
  let renewal: Promise<void> | undefined;
  const renew = () => {
    const now = new Date();
    renewal = lock.utimes(now, now).catch(() => {});
  };
  const heartbeat = setInterval(renew, HISTORY_LOCK_HEARTBEAT_MS);

  return async () => {
    clearInterval(heartbeat);
    await renewal;
  };
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
  const releasePath = `${lockPath}.release.${ownerToken}`;
  try {
    const lockSnapshot = await readHistoryLockSnapshot(lockPath);
    if (lockSnapshot.ownerToken !== ownerToken) return;

    const recheck = await readHistoryLockSnapshot(lockPath);
    if (recheck.ownerToken !== ownerToken) return;

    // Atomically detach the lock from its path so no new writer can acquire it
    // while we verify ownership. This closes the race where a stale takeover
    // unlinks and a new writer creates a new lock between our recheck and unlink.
    await rename(lockPath, releasePath);
    try {
      const content = await readFile(releasePath, 'utf-8');
      if (content !== ownerToken) {
        // Detached someone else's lock — restore it.
        await rename(releasePath, lockPath).catch(() => {});
        return;
      }
      await unlink(releasePath);
    } catch {
      // File already gone — fine.
    }
  } catch (error) {
    if (!hasErrorCode(error, 'ENOENT')) throw error;
  }
}

async function hasHistoryLockTakeover(lockPath: string): Promise<boolean> {
  const takeover = `${lockPath}${HISTORY_LOCK_TAKEOVER_SUFFIX}`;
  try {
    const lock = await open(takeover, 'r');
    const stats = await lock.stat();
    await lock.close();

    if (Date.now() - stats.mtimeMs > HISTORY_LOCK_STALE_MS) {
      await unlink(takeover).catch(() => {});
      return false;
    }
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
      if (
        currentSnapshot.ownerToken === lockSnapshot.ownerToken &&
        Date.now() - currentSnapshot.mtimeMs > HISTORY_LOCK_STALE_MS
      ) {
        // Atomically detach the lock before verifying to prevent a race where
        // the owner releases and a new writer acquires between our check and unlink.
        const staleRemovalPath = `${lockPath}.stale-removal.${randomUUID()}`;
        await rename(lockPath, staleRemovalPath);
        try {
          const content = await readFile(staleRemovalPath, 'utf-8');
          if (content !== lockSnapshot.ownerToken) {
            // Detached a new writer's lock — restore it.
            await rename(staleRemovalPath, lockPath).catch(() => {});
          } else {
            await unlink(staleRemovalPath);
          }
        } catch {
          // File already gone — fine.
        }
      }
    } catch (error) {
      if (!hasErrorCode(error, 'ENOENT')) throw error;
    } finally {
      await unlink(takeoverPath).catch(() => {});
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
      try {
        await lock.writeFile(ownerToken, 'utf-8');
      } catch (writeError) {
        await lock.close();
        await unlink(lockPath).catch(() => {});
        throw writeError;
      }
      const stopMaintainingLease = maintainHistoryLockLease(lock);

      return async () => {
        await stopMaintainingLease();
        await lock.close();
        await removeHistoryLock(lockPath, ownerToken);
      };
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

  const entries: CommitEntry[] = [];
  const corruptedLineNumbers: Array<number | undefined> = [];
  const history = await open(historyPath, 'r');

  try {
    const { size } = await history.stat();
    let position = size;
    let remainder = Buffer.alloc(0);
    let processedLineCount = 0;
    let totalLineCount: number | undefined;
    const corruptedLineIndexesFromEnd: number[] = [];

    const parseLine = (lineBytes: Buffer) => {
      const lineIndexFromEnd = processedLineCount++;
      const line = lineBytes.toString('utf-8');
      if (line.trim().length === 0) return;

      try {
        entries.push(JSON.parse(line) as CommitEntry);
      } catch {
        corruptedLineIndexesFromEnd.push(lineIndexFromEnd);
      }
    };

    while (position > 0 && entries.length < limit) {
      const chunkEnd = position;
      position = Math.max(0, chunkEnd - HISTORY_READ_CHUNK_SIZE - 3);
      const bytesToRead = chunkEnd - position;
      const buffer = Buffer.allocUnsafe(bytesToRead);
      const { bytesRead } = await history.read(buffer, 0, bytesToRead, position);
      const chunk = Buffer.concat([buffer.subarray(0, bytesRead), remainder]);
      const lines: Buffer[] = [];
      const firstLineEnd = chunk.indexOf(0x0a);
      if (firstLineEnd === -1) {
        remainder = chunk;
      } else {
        remainder = chunk.subarray(0, firstLineEnd);
        let lineStart = firstLineEnd + 1;
        for (let index = lineStart; index < chunk.length; index++) {
          if (chunk[index] === 0x0a) {
            lines.push(chunk.subarray(lineStart, index));
            lineStart = index + 1;
          }
        }
        lines.push(chunk.subarray(lineStart));
      }
      const processedBeforeChunk = processedLineCount;

      if (position === 0) {
        totalLineCount = processedBeforeChunk + lines.length + 1;
      }

      for (let index = lines.length - 1; index >= 0 && entries.length < limit; index--) {
        parseLine(lines[index]!);
      }
    }

    if (position === 0 && entries.length < limit) {
      parseLine(remainder);
    }

    for (const lineIndexFromEnd of corruptedLineIndexesFromEnd) {
      corruptedLineNumbers.push(totalLineCount === undefined ? undefined : totalLineCount - lineIndexFromEnd);
    }
  } finally {
    await history.close();
  }

  warnCorruptedHistory(historyPath, corruptedLineNumbers);

  return entries;
}

/** Emit a compact warning that identifies corrupted history line numbers. */
function warnCorruptedHistory(historyPath: string, corruptedLineNumbers: Array<number | undefined>): void {
  if (corruptedLineNumbers.length === 0) return;

  const count = corruptedLineNumbers.length;
  const noun = count === 1 ? 'entry' : 'entries';
  const knownLineNumbers = corruptedLineNumbers.filter((lineNumber): lineNumber is number => lineNumber !== undefined);
  const lines = knownLineNumbers
    .slice(0, 5)
    .sort((a, b) => a - b)
    .join(', ');
  const suffix = count > 5 ? `, +${count - 5} more` : '';
  const location = knownLineNumbers.length === count ? `line ${lines}${suffix}` : 'recently scanned rows';

  console.warn(`Warning: ignored ${count} corrupted commit history ${noun} in ${historyPath} (${location}).`);
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
