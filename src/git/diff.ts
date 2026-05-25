import { execSync, spawnSync } from 'node:child_process';

export interface DiffResult {
  diff: string;
  hasChanges: boolean;
  staged: boolean;
}

export function checkGitRepo(): boolean {
  try {
    execSync('git rev-parse --git-dir', { encoding: 'utf-8', stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function getStagedDiff(): DiffResult {
  const diff = execSync('git diff --cached', { encoding: 'utf-8' });
  return {
    diff: diff.trim(),
    hasChanges: diff.trim().length > 0,
    staged: true,
  };
}

export function getUnstagedDiff(): DiffResult {
  const diff = execSync('git diff', { encoding: 'utf-8' });
  return {
    diff: diff.trim(),
    hasChanges: diff.trim().length > 0,
    staged: false,
  };
}

export function getCombinedDiff(): DiffResult {
  const staged = getStagedDiff();
  const unstaged = getUnstagedDiff();
  const combined = [staged.diff, unstaged.diff].filter(Boolean).join('\n');
  return {
    diff: combined.trim(),
    hasChanges: combined.trim().length > 0,
    staged: staged.hasChanges,
  };
}

export function commit(message: string, body?: string): string {
  const fullMessage = body ? `${message}\n\n${body}` : message;
  const result = spawnSync('git', ['commit', '-m', fullMessage], {
    encoding: 'utf-8',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr || `git commit exited with code ${result.status}`);
  }
  return result.stdout;
}

export function getRepoRoot(): string {
  return execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim();
}
