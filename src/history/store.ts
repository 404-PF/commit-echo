import { readFile, writeFile, appendFile, mkdir, open, unlink, rename } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { CommitEntry, StyleProfile } from '../types.js';
import { getHistoryPath, getConfigDir } from '../config/store.js';

const CONVENTIONAL_PREFIX_RE = /^(feat|fix|chore|docs|style|refactor|perf|test|build|ci|revert)(\([^)]+\))?:\s*/;

const BASE_FORM_VERBS_WITH_SUFFIXES = new Set([
  'bed',
  'bleed',
  'breed',
  'bring',
  'cling',
  'deed',
  'ding',
  'embed',
  'exceed',
  'feed',
  'fling',
  'heed',
  'imbed',
  'king',
  'need',
  'ping',
  'proceed',
  'ring',
  'seed',
  'shed',
  'shred',
  'sing',
  'sled',
  'sling',
  'speed',
  'spring',
  'sting',
  'string',
  'succeed',
  'swing',
  'wed',
  'weed',
  'wing',
  'wring',
  'zing',
]);

const VERB_PREFIXES = ['counter', 'inter', 'over', 'under', 'fore', 'mis', 'pre', 'un', 're'];

// Full verbs that would falsely match a prefix + base-form stem (e.g. "resting" = "re" + "sting").
const VERB_PREFIX_STRIP_COLLISIONS = new Set(['resting']);

function stripVerbPrefix(verb: string): string {
  for (const prefix of VERB_PREFIXES) {
    if (verb.length > prefix.length && verb.startsWith(prefix)) {
      const stem = verb.slice(prefix.length);
      if (BASE_FORM_VERBS_WITH_SUFFIXES.has(stem) && !VERB_PREFIX_STRIP_COLLISIONS.has(verb)) {
        return stem;
      }
    }
  }
  return verb;
}

function isDescriptiveVerb(verb: string): boolean {
  const normalized = verb.toLowerCase();
  const base = stripVerbPrefix(normalized);
  return !BASE_FORM_VERBS_WITH_SUFFIXES.has(base) && (normalized.endsWith('ed') || normalized.endsWith('ing'));
}

const HISTORY_LOCK_RETRY_MS = 25;
const HISTORY_LOCK_STALE_MS = 60_000;
const HISTORY_LOCK_TIMEOUT_MS = HISTORY_LOCK_STALE_MS + 10_000;
const HISTORY_LOCK_HEARTBEAT_MS = 15_000;
const HISTORY_LOCK_TAKEOVER_SUFFIX = '.takeover';
const HISTORY_READ_CHUNK_SIZE = 64 * 1024;

/** Split a buffer into complete newline-delimited lines and an incomplete remainder. */
function splitCompleteLines(combined: Buffer): { lines: Buffer[]; remainder: Buffer } {
  const firstLineEnd = combined.indexOf(0x0a);
  if (firstLineEnd === -1) return { lines: [], remainder: combined };

  const lines: Buffer[] = [];
  let lineStart = firstLineEnd + 1;
  for (let index = lineStart; index < combined.length; index++) {
    if (combined[index] === 0x0a) {
      lines.push(combined.subarray(lineStart, index));
      lineStart = index + 1;
    }
  }
  lines.push(combined.subarray(lineStart));
  return { lines, remainder: combined.subarray(0, firstLineEnd) };
}

/** Parse a single line buffer, pushing valid entries or recording corrupted line numbers. */
function processHistoryLine(
  lineBytes: Buffer,
  lineIndexFromEnd: number,
  entries: CommitEntry[],
  corruptedLineIndexesFromEnd: number[],
): void {
  const line = lineBytes.toString('utf-8');
  if (line.trim().length === 0) return;

  try {
    entries.push(JSON.parse(line) as CommitEntry);
  } catch {
    corruptedLineIndexesFromEnd.push(lineIndexFromEnd);
  }
}

/** Read a complete history chunk, retrying when the filesystem returns a short read. */
export async function readHistoryChunk(
  history: Pick<FileHandle, 'read'>,
  buffer: Buffer,
  position: number,
  bytesToRead: number,
): Promise<number> {
  let bytesRead = 0;

  while (bytesRead < bytesToRead) {
    const result = await history.read(buffer, bytesRead, bytesToRead - bytesRead, position + bytesRead);
    if (result.bytesRead === 0) break;
    bytesRead += result.bytesRead;
  }

  return bytesRead;
}

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

/** State accumulated while scanning a history file backward. */
interface HistoryScanState {
  entries: CommitEntry[];
  processedLineCount: number;
  totalLineCount: number | undefined;
  remainderChunks: Buffer[];
  corruptedLineIndexesFromEnd: number[];
}

/** Process one backward-read chunk, returning updated scan state. */
function processChunk(
  chunk: Buffer,
  state: HistoryScanState,
  position: number,
  limit: number,
): void {
  if (!chunk.includes(0x0a)) {
    state.remainderChunks.unshift(chunk);
    if (position === 0) {
      state.totalLineCount = state.processedLineCount + 1;
    }
    return;
  }

  const combined = state.remainderChunks.length === 0 ? chunk : Buffer.concat([chunk, ...state.remainderChunks]);
  const { lines, remainder: newRemainder } = splitCompleteLines(combined);
  state.remainderChunks = [newRemainder];

  if (position === 0) {
    state.totalLineCount = state.processedLineCount + lines.length + 1;
  }

  for (let index = lines.length - 1; index >= 0 && state.entries.length < limit; index--) {
    processHistoryLine(lines[index]!, state.processedLineCount++, state.entries, state.corruptedLineIndexesFromEnd);
  }
}

/** Process the remaining partial-line bytes after the main scan loop. */
function processRemainder(state: HistoryScanState, limit: number): void {
  const remainder = state.remainderChunks.length === 1 ? state.remainderChunks[0]! : Buffer.concat(state.remainderChunks);
  processHistoryLine(remainder, state.processedLineCount++, state.entries, state.corruptedLineIndexesFromEnd);
}

/** Load recent valid history entries while warning once about corrupted JSONL rows. */
export async function loadEntries(limit = 200): Promise<CommitEntry[]> {
  const historyPath = getHistoryPath();
  if (!existsSync(historyPath)) return [];

  const corruptedLineNumbers: Array<number | undefined> = [];
  const state: HistoryScanState = {
    entries: [],
    processedLineCount: 0,
    totalLineCount: undefined,
    remainderChunks: [],
    corruptedLineIndexesFromEnd: [],
  };

  const history = await open(historyPath, 'r');
  try {
    const { size } = await history.stat();
    let position = size;

    while (position > 0 && state.entries.length < limit) {
      const chunkEnd = position;
      position = Math.max(0, chunkEnd - HISTORY_READ_CHUNK_SIZE - 3);
      const bytesToRead = chunkEnd - position;
      const buffer = Buffer.allocUnsafe(bytesToRead);
      const bytesRead = await readHistoryChunk(history, buffer, position, bytesToRead);
      processChunk(buffer.subarray(0, bytesRead), state, position, limit);
    }

    if (position === 0 && state.entries.length < limit) {
      processRemainder(state, limit);
    }

    for (const lineIndexFromEnd of state.corruptedLineIndexesFromEnd) {
      corruptedLineNumbers.push(state.totalLineCount === undefined ? undefined : state.totalLineCount - lineIndexFromEnd);
    }
  } finally {
    await history.close();
  }

  warnCorruptedHistory(historyPath, corruptedLineNumbers);

  return state.entries;
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
    const verb = verbMatch?.[1] ?? /^\w+/.exec(firstLine)?.[0];
    if (verb) {
      imperativeSampleCount++;
      if (!isDescriptiveVerb(verb)) {
        imperativeCount++;
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
