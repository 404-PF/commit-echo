import { execSync, spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, normalize } from 'node:path';

export interface DiffResult {
  diff: string;
  hasChanges: boolean;
  staged: boolean;
}

export interface CommitResult {
  hash: string;
  summary: string;
  output: string;
}

const GIT_DIFF_MAX_BUFFER = 100 * 1024 * 1024;

export function checkGitRepo(): void {
  try {
    execSync('git rev-parse --git-dir', { encoding: 'utf-8', stdio: 'pipe' });
  } catch (err) {
    const stderr = (err as NodeJS.ErrnoException & { stderr?: string }).stderr?.trim();
    throw new Error(stderr || 'Not a git repository');
  }
}

export function getStagedDiff(): DiffResult {
  const diff = execSync('git diff --cached', {
    encoding: 'utf-8',
    maxBuffer: GIT_DIFF_MAX_BUFFER,
  });
  return {
    diff: diff.trim(),
    hasChanges: diff.trim().length > 0,
    staged: true,
  };
}

export function getUnstagedDiff(): DiffResult {
  const diff = execSync('git diff', {
    encoding: 'utf-8',
    maxBuffer: GIT_DIFF_MAX_BUFFER,
  });
  return {
    diff: diff.trim(),
    hasChanges: diff.trim().length > 0,
    staged: false,
  };
}

function parseCommitOutput(output: string): CommitResult {
  const summary = output.trim().split('\n').find(Boolean) ?? '';
  const match = summary.match(/^\[(?:.+\s)?([a-f0-9]{7,})\]\s+(.+)$/i);

  return {
    hash: match?.[1] ?? '',
    summary: match?.[2] ?? summary,
    output,
  };
}

export function commit(message: string, body?: string): CommitResult {
  const fullMessage = body ? `${message}\n\n${body}` : message;
  const tmpFile = join(tmpdir(), `commit-echo-msg-${process.pid}-${Date.now()}.txt`);
  try {
    writeFileSync(tmpFile, fullMessage, 'utf-8');
    const result = spawnSync('git', ['commit', '-F', tmpFile], {
      encoding: 'utf-8',
      shell: false,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      const detail = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
      throw new Error(detail || `git commit exited with code ${result.status}`);
    }
    return parseCommitOutput(result.stdout);
  } finally {
    try {
      unlinkSync(tmpFile);
    } catch {}
  }
}

export function getRepoRoot(): string {
  return normalize(execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim());
}

export function getBranchName(): string {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}
