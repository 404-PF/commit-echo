import type { CommitEntry } from "../git/log.js";
import type { StyleProfile } from "../config/types.js";

const CONVENTIONAL_PREFIX_RE = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\(.+\))?!?:\s/i;

interface AnalyzedCommit {
  subject: string;
  body: string;
  prefix: string | null;
  hasScope: boolean;
  isImperative: boolean;
  subjectLength: number;
}

function detectPrefix(subject: string): string | null {
  const match = subject.match(CONVENTIONAL_PREFIX_RE);
  return match ? match[1] : null;
}

function hasScope(subject: string): boolean {
  return CONVENTIONAL_PREFIX_RE.test(subject) && subject.includes("(");
}

function isProbablyImperative(subject: string): boolean {
  const cleaned = subject.replace(CONVENTIONAL_PREFIX_RE, "");
  const firstWord = cleaned.trim().split(/\s+/)[0]?.toLowerCase();
  if (!firstWord) return true;
  const nonImperative = ["added", "fixed", "removed", "updated", "changed", "implemented", "created", "moved", "renamed", "bumped"];
  return !nonImperative.includes(firstWord);
}

function analyzeCommit(entry: CommitEntry): AnalyzedCommit {
  return {
    subject: entry.subject,
    body: entry.body,
    prefix: detectPrefix(entry.subject),
    hasScope: hasScope(entry.subject),
    isImperative: isProbablyImperative(entry.subject),
    subjectLength: entry.subject.length,
  };
}

export function analyzeCommits(entries: CommitEntry[]): StyleProfile {
  if (entries.length === 0) {
    throw new Error("No commits to analyze");
  }

  const analyzed = entries.map(analyzeCommit);

  const prefixCounts = new Map<string, number>();
  for (const a of analyzed) {
    if (a.prefix) {
      prefixCounts.set(a.prefix, (prefixCounts.get(a.prefix) ?? 0) + 1);
    }
  }

  let dominantPrefix = "";
  let maxCount = 0;
  for (const [p, c] of prefixCounts) {
    if (c > maxCount) {
      maxCount = c;
      dominantPrefix = p;
    }
  }

  const commitsWithPrefix = analyzed.filter((a) => a.prefix).length;
  const commitsWithScope = analyzed.filter((a) => a.hasScope).length;
  const commitsWithBody = analyzed.filter((a) => a.body.length > 0).length;
  const imperativeCount = analyzed.filter((a) => a.isImperative).length;

  const avgLength = Math.round(
    analyzed.reduce((sum, a) => sum + a.subjectLength, 0) / analyzed.length
  );

  const tone: "imperative" | "descriptive" | "mixed" =
    imperativeCount === analyzed.length
      ? "imperative"
      : imperativeCount === 0
        ? "descriptive"
        : "mixed";

  const examples = analyzed
    .slice(0, 5)
    .map((a) => a.subject);

  return {
    dominantPrefix,
    prefixPct: Math.round((commitsWithPrefix / analyzed.length) * 100),
    usesScope: commitsWithScope > 0,
    scopePct: Math.round((commitsWithScope / analyzed.length) * 100),
    avgSubjectLength: avgLength,
    tone,
    usesBody: commitsWithBody > 0,
    bodyPct: Math.round((commitsWithBody / analyzed.length) * 100),
    examples,
    analyzedAt: new Date().toISOString(),
    totalCommits: analyzed.length,
  };
}
