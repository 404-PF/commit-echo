import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { CommitEntry, StyleProfile } from '../types.js';
import { getHistoryPath, getConfigDir } from '../config/store.js';

const CONVENTIONAL_PREFIX_RE = /^(feat|fix|chore|docs|style|refactor|perf|test|build|ci|revert)(\([^)]+\))?:\s*/;

export async function appendEntry(entry: CommitEntry): Promise<void> {
  const historyPath = getHistoryPath();
  const configDir = getConfigDir();
  if (!existsSync(configDir)) {
    await mkdir(configDir, { recursive: true });
  }
  await appendFile(historyPath, JSON.stringify(entry) + '\n', 'utf-8');
}

export async function loadEntries(limit = 200): Promise<CommitEntry[]> {
  const historyPath = getHistoryPath();
  if (!existsSync(historyPath)) return [];

  const raw = await readFile(historyPath, 'utf-8');
  const lines = raw.split('\n').filter(Boolean).reverse().slice(0, limit);

  return lines
    .map((line) => {
      try {
        return JSON.parse(line) as CommitEntry;
      } catch {
        return null;
      }
    })
    .filter((e): e is CommitEntry => e !== null);
}

export async function countEntries(): Promise<number> {
  const historyPath = getHistoryPath();
  if (!existsSync(historyPath)) return 0;

  const raw = await readFile(historyPath, 'utf-8');
  return raw.split('\n').filter(Boolean).length;
}

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
