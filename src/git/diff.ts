import { execSync, spawnSync } from 'node:child_process';

export interface DiffResult {
  diff: string;
  hasChanges: boolean;
  staged: boolean;
}

export function checkGitRepo(): void {
  try {
    execSync('git rev-parse --git-dir', { encoding: 'utf-8', stdio: 'pipe' });
  } catch (err) {
    const stderr = (err as NodeJS.ErrnoException & { stderr?: string }).stderr?.trim();
    throw new Error(stderr || 'Not a git repository');
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


export function commit(message: string, body?: string): string {
  const fullMessage = body ? `${message}\n\n${body}` : message;
  const result = spawnSync('git', ['commit', '-m', fullMessage], {
    encoding: 'utf-8',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
    throw new Error(detail || `git commit exited with code ${result.status}`);
  }
  return result.stdout;
}

export function getRepoRoot(): string {
  return execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim();
}
