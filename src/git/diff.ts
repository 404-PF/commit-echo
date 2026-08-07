import { execFileSync, spawnSync } from 'node:child_process';
import {
  accessSync,
  copyFileSync,
  existsSync,
  constants,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, isAbsolute, join, normalize, resolve } from 'node:path';

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
const GIT_EXECUTABLE_NAME = process.platform === 'win32' ? 'git.exe' : 'git';
let gitExecutable: string | undefined;

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

export function hasCommits(): boolean {
  try {
    const count = execFileSync(getGitExecutable(), ['rev-list', '--count', 'HEAD'], {
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim();

    return Number.parseInt(count, 10) > 0;
  } catch {
    return false;
  }
}

export function getStagedDiff(): DiffResult {
  const diff = execFileSync(getGitExecutable(), ['diff', '--cached'], {
    encoding: 'utf-8',
    maxBuffer: GIT_DIFF_MAX_BUFFER,
  });
  return {
    diff: diff.trim(),
    hasChanges: diff.trim().length > 0,
    staged: true,
  };
}

function getGitPath(path: string): string {
  return resolve(
    execFileSync(getGitExecutable(), ['rev-parse', '--git-path', path], {
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim(),
  );
}

function getUntrackedDiff(): string {
  const untrackedEntries = execFileSync(getGitExecutable(), ['ls-files', '--others', '--exclude-standard', '-z'], {
    encoding: 'utf-8',
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
        cwd: resolve(entry),
        encoding: 'utf-8',
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
    const indexPath = getGitPath('index');
    if (existsSync(indexPath)) {
      copyFileSync(indexPath, tempIndex);
    }

    const env = { ...process.env, GIT_INDEX_FILE: tempIndex };
    const addResult = spawnSync(
      getGitExecutable(),
      ['--literal-pathspecs', 'add', '--intent-to-add', '--pathspec-from-file=-', '--pathspec-file-nul'],
      {
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
      encoding: 'utf-8',
      env,
      maxBuffer: GIT_DIFF_MAX_BUFFER,
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export function getUnstagedDiff(): DiffResult {
  const untrackedAwareDiff = getUntrackedDiff();
  const trackedDiff = execFileSync(getGitExecutable(), ['diff'], {
    encoding: 'utf-8',
    maxBuffer: GIT_DIFF_MAX_BUFFER,
  });
  const diff = [trackedDiff.trim(), untrackedAwareDiff.trim()].filter(Boolean).join('\n');
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

export function commit(message: string, body?: string): CommitResult {
  const fullMessage = body ? `${message}\n\n${body}` : message;
  const tmpFile = join(tmpdir(), `commit-echo-msg-${process.pid}-${Date.now()}.txt`);
  try {
    writeFileSync(tmpFile, fullMessage, 'utf-8');
    const result = spawnSync(getGitExecutable(), ['commit', '-F', tmpFile], {
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
  return normalize(execFileSync(getGitExecutable(), ['rev-parse', '--show-toplevel'], { encoding: 'utf-8' }).trim());
}

export function getBranchName(): string {
  try {
    return execFileSync(getGitExecutable(), ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

export function getLastCommitMessage(): string {
  try {
    return execFileSync(getGitExecutable(), ['log', '-1', '--format=%s'], {
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim();
  } catch {
    return '';
  }
}
