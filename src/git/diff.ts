import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { accessSync, copyFileSync, existsSync, constants, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, isAbsolute, join, normalize, resolve } from 'node:path';
import { promisify } from 'node:util';

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

export interface IndexSnapshot {
  path: string;
  cleanup: () => void;
}

const GIT_DIFF_MAX_BUFFER = 100 * 1024 * 1024;
const GIT_REPOSITORY_ENV_VARS = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_COMMON_DIR',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
] as const;
const GIT_EXECUTABLE_NAME = process.platform === 'win32' ? 'git.exe' : 'git';
let gitExecutable: string | undefined;
const execFileAsync = promisify(execFile);

function getGitEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const variable of GIT_REPOSITORY_ENV_VARS) {
    delete env[variable];
  }
  return { ...env, ...overrides };
}

function isExecutableFile(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function getGitExecPathCandidates(gitExecPath: string | undefined): string[] {
  if (!gitExecPath || !isAbsolute(gitExecPath)) {
    return [];
  }

  return process.platform === 'win32'
    ? [join(gitExecPath, '..', '..', GIT_EXECUTABLE_NAME)]
    : [join(gitExecPath, '..', '..', 'bin', GIT_EXECUTABLE_NAME)];
}

function getWindowsGitCandidates(): string[] {
  const programFiles = [
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    String.raw`C:\Program Files`,
  ].filter((value): value is string => Boolean(value));
  const programFileCandidates = programFiles.flatMap((root) => [
    join(root, 'Git', 'cmd', GIT_EXECUTABLE_NAME),
    join(root, 'Git', 'mingw64', 'bin', GIT_EXECUTABLE_NAME),
  ]);
  const localAppData = process.env.LOCALAPPDATA;

  return localAppData
    ? [...programFileCandidates, join(localAppData, 'Programs', 'Git', 'cmd', GIT_EXECUTABLE_NAME)]
    : programFileCandidates;
}

function getUnixGitCandidates(): string[] {
  return ['/usr/bin/git', '/usr/local/bin/git', '/opt/homebrew/bin/git', '/opt/local/bin/git', '/bin/git'];
}

function getPathGitCandidates(): string[] {
  const pathValue = process.env.PATH ?? process.env.Path ?? '';
  return pathValue.split(delimiter).map((directory) => resolve(process.cwd(), directory || '.', GIT_EXECUTABLE_NAME));
}

function resolveGitExecutable(): string {
  const candidates = [
    ...getGitExecPathCandidates(process.env.GIT_EXEC_PATH),
    ...getPathGitCandidates(),
    ...(process.platform === 'win32' ? getWindowsGitCandidates() : getUnixGitCandidates()),
  ].map((candidate) => resolve(candidate));
  const executable = candidates.find(isExecutableFile);

  if (!executable) {
    throw new Error('git is not installed or not found in a supported location');
  }

  return normalize(executable);
}

export function getGitExecutable(): string {
  gitExecutable ??= resolveGitExecutable();
  return gitExecutable;
}

export function checkGitRepo(): void {
  const executable = getGitExecutable();
  try {
    execFileSync(executable, ['rev-parse', '--git-dir'], { encoding: 'utf-8', stdio: 'pipe' });
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException & { stderr?: string };
    if (nodeErr.code === 'ENOENT') {
      throw new Error('git is not installed or not found in a supported location');
    }
    const stderr = nodeErr.stderr?.trim();
    throw new Error(stderr || 'Not a git repository');
  }
}

export async function checkGitRepoWithSignal(signal?: AbortSignal): Promise<void> {
  const executable = getGitExecutable();
  try {
    await execFileAsync(executable, ['rev-parse', '--git-dir'], {
      encoding: 'utf-8',
      signal,
    });
  } catch (err) {
    if (signal?.aborted) {
      throw signal.reason instanceof Error ? signal.reason : new Error('Git repository check was cancelled');
    }

    const nodeErr = err as NodeJS.ErrnoException & { stderr?: string };
    if (nodeErr.code === 'ENOENT') {
      throw new Error('git is not installed or not found in a supported location');
    }

    const stderr = nodeErr.stderr?.trim();
    throw new Error(stderr || 'Not a git repository');
  }
}

export async function getStagedDiffWithSignal(
  cwd = process.cwd(),
  indexFile?: string,
  signal?: AbortSignal,
): Promise<DiffResult> {
  try {
    const { stdout } = await execFileAsync(getGitExecutable(), ['diff', '--cached'], {
      cwd,
      encoding: 'utf-8',
      env: getGitEnv(indexFile ? { GIT_INDEX_FILE: indexFile } : {}),
      maxBuffer: GIT_DIFF_MAX_BUFFER,
      signal,
    });

    return {
      diff: stdout,
      hasChanges: stdout.trim().length > 0,
      staged: true,
    };
  } catch (err) {
    if (signal?.aborted) {
      throw signal.reason instanceof Error ? signal.reason : new Error('Git staged diff was cancelled');
    }
    throw err;
  }
}

function isUnbornHead(): boolean {
  let headRef: string;
  try {
    headRef = execFileSync(getGitExecutable(), ['symbolic-ref', '--quiet', 'HEAD'], {
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim();
  } catch {
    // A detached or malformed HEAD is not the normal empty-repository state.
    return false;
  }

  try {
    const refs = execFileSync(getGitExecutable(), ['for-each-ref', '--format=%(refname)', headRef], {
      encoding: 'utf-8',
      stdio: 'pipe',
    })
      .split(/\r?\n/)
      .filter(Boolean);

    return headRef.length > 0 && !refs.includes(headRef);
  } catch {
    // If the ref database cannot be queried, keep the original fatal Git error.
    return false;
  }
}

export function hasCommits(): boolean {
  try {
    const count = execFileSync(getGitExecutable(), ['rev-list', '--count', 'HEAD'], {
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim();

    return Number.parseInt(count, 10) > 0;
  } catch (err) {
    if (isUnbornHead()) {
      return false;
    }

    const nodeErr = err as NodeJS.ErrnoException & { stderr?: string };
    const stderr = nodeErr.stderr?.trim();
    throw new Error(stderr || nodeErr.message || 'Failed to inspect git history');
  }
}

export function getStagedDiff(cwd = process.cwd(), indexFile?: string): DiffResult {
  const diff = execFileSync(getGitExecutable(), ['diff', '--cached'], {
    cwd,
    encoding: 'utf-8',
    env: getGitEnv(indexFile ? { GIT_INDEX_FILE: indexFile } : {}),
    maxBuffer: GIT_DIFF_MAX_BUFFER,
  });
  return {
    diff,
    hasChanges: diff.trim().length > 0,
    staged: true,
  };
}

export function createIndexSnapshot(cwd = process.cwd()): IndexSnapshot {
  const tempDir = mkdtempSync(join(tmpdir(), 'commit-echo-index-snapshot-'));
  const indexFile = join(tempDir, 'index');

  try {
    const indexPath = getGitPath('index', cwd);
    if (existsSync(indexPath)) {
      copyFileSync(indexPath, indexFile);
    }
  } catch (err) {
    rmSync(tempDir, { recursive: true, force: true });
    throw err;
  }

  return {
    path: indexFile,
    cleanup: () => rmSync(tempDir, { recursive: true, force: true }),
  };
}

/**
 * Check for tracked unstaged or non-ignored untracked changes without
 * constructing the full untracked-aware diff.
 */
export function hasUnstagedChanges(cwd = process.cwd()): boolean {
  const status = execFileSync(getGitExecutable(), ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd,
    encoding: 'utf-8',
    env: getGitEnv(),
    maxBuffer: GIT_DIFF_MAX_BUFFER,
  });
  return status.split('\n').some((line) => line.length >= 2 && line[1] !== ' ');
}

function getGitPath(path: string, cwd: string): string {
  return resolve(
    cwd,
    execFileSync(getGitExecutable(), ['rev-parse', '--git-path', path], {
      cwd,
      encoding: 'utf-8',
      env: getGitEnv(),
      stdio: 'pipe',
    }).trim(),
  );
}

function getUntrackedDiff(cwd = process.cwd()): string {
  const untrackedEntries = execFileSync(getGitExecutable(), ['ls-files', '--others', '--exclude-standard', '-z'], {
    cwd,
    encoding: 'utf-8',
    env: getGitEnv(),
    maxBuffer: GIT_DIFF_MAX_BUFFER,
  })
    .split('\0')
    .filter(Boolean);
  if (untrackedEntries.length === 0) {
    return '';
  }

  const pathspecs = untrackedEntries.filter((entry) => {
    if (!entry.endsWith('/')) {
      return true;
    }

    try {
      execFileSync(getGitExecutable(), ['rev-parse', '--verify', 'HEAD'], {
        cwd: resolve(cwd, entry),
        encoding: 'utf-8',
        env: getGitEnv(),
        stdio: 'pipe',
      });
      return true;
    } catch {
      return false;
    }
  });
  if (pathspecs.length === 0) {
    return '';
  }

  const tempDir = mkdtempSync(join(tmpdir(), 'commit-echo-index-'));
  const tempIndex = join(tempDir, 'index');

  try {
    const indexPath = getGitPath('index', cwd);
    if (existsSync(indexPath)) {
      copyFileSync(indexPath, tempIndex);
    }

    const env = getGitEnv({ GIT_INDEX_FILE: tempIndex });
    const addResult = spawnSync(
      getGitExecutable(),
      ['--literal-pathspecs', 'add', '--intent-to-add', '--pathspec-from-file=-', '--pathspec-file-nul'],
      {
        cwd,
        encoding: 'utf-8',
        env,
        input: `${pathspecs.join('\0')}\0`,
        maxBuffer: GIT_DIFF_MAX_BUFFER,
        stdio: 'pipe',
      },
    );
    if (addResult.error) throw addResult.error;
    if (addResult.status !== 0) {
      const detail = [addResult.stderr, addResult.stdout].filter(Boolean).join('\n').trim();
      throw new Error(detail || `git add --intent-to-add exited with code ${addResult.status}`);
    }

    return execFileSync(getGitExecutable(), ['--literal-pathspecs', 'diff', '--', ...pathspecs], {
      cwd,
      encoding: 'utf-8',
      env,
      maxBuffer: GIT_DIFF_MAX_BUFFER,
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export function getUnstagedDiff(cwd = process.cwd()): DiffResult {
  const untrackedAwareDiff = getUntrackedDiff(cwd);
  const trackedDiff = execFileSync(getGitExecutable(), ['diff'], {
    cwd,
    encoding: 'utf-8',
    env: getGitEnv(),
    maxBuffer: GIT_DIFF_MAX_BUFFER,
  });
  const parts = [trackedDiff, untrackedAwareDiff].filter((part) => part.trim().length > 0);
  const diff = parts.reduce((combined, part) => {
    if (!combined) return part;
    return combined.endsWith('\n') || combined.endsWith('\r') ? combined + part : combined + '\n' + part;
  }, '');
  return {
    diff,
    hasChanges: diff.length > 0,
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

export function commit(message: string, body?: string, cwd = process.cwd(), indexFile?: string): CommitResult {
  const fullMessage = body ? `${message}\n\n${body}` : message;
  const result = spawnSync(getGitExecutable(), ['commit', '-F', '-'], {
    cwd,
    encoding: 'utf-8',
    env: getGitEnv(indexFile ? { GIT_INDEX_FILE: indexFile } : {}),
    input: fullMessage,
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
    throw new Error(detail || `git commit exited with code ${result.status}`);
  }
  return parseCommitOutput(result.stdout);
}

export function getRepoRoot(): string {
  return normalize(execFileSync(getGitExecutable(), ['rev-parse', '--show-toplevel'], { encoding: 'utf-8' }).trim());
}

export function getBranchName(cwd = process.cwd()): string {
  try {
    return execFileSync(getGitExecutable(), ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      encoding: 'utf-8',
      env: getGitEnv(),
    }).trim();
  } catch {
    return 'unknown';
  }
}

export function getLastCommitMessage(cwd = process.cwd()): string {
  try {
    return execFileSync(getGitExecutable(), ['log', '-1', '--format=%s'], {
      cwd,
      encoding: 'utf-8',
      env: getGitEnv(),
      stdio: 'pipe',
    }).trim();
  } catch {
    return '';
  }
}
