import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function runCompletion(args = []) {
  return execFileAsync(process.execPath, ['dist/index.js', '--no-color', 'completion', ...args], {
    env: { ...process.env, NO_COLOR: '1' },
  });
}

test('completion with no arguments prints help message', async () => {
  const { stdout } = await runCompletion([]);
  assert.match(stdout, /bash/);
  assert.match(stdout, /zsh/);
  assert.match(stdout, /fish/);
  assert.match(stdout, /Usage:/);
});

test('completion bash outputs a bash completion script', async () => {
  const { stdout } = await runCompletion(['bash']);
  assert.match(stdout, /complete -F _commit_echo commit-echo/);
  assert.match(stdout, /_commit_echo\(\)/);
});

test('completion zsh outputs a zsh completion script', async () => {
  const { stdout } = await runCompletion(['zsh']);
  assert.match(stdout, /#compdef commit-echo/);
  assert.match(stdout, /_commit_echo\(\)/);
});

test('completion fish outputs a fish completion script', async () => {
  const { stdout } = await runCompletion(['fish']);
  assert.match(stdout, /complete -c commit-echo/);
  assert.match(stdout, /__commit_echo_completions/);
});

test('completion bash script includes all subcommands', async () => {
  const { stdout } = await runCompletion(['bash']);
  const expectedSubcommands = ['init', 'config', 'suggest', 'history', 'batch', 'completion'];
  for (const subcmd of expectedSubcommands) {
    assert.ok(stdout.includes(subcmd), `Expected stdout to contain subcommand: ${subcmd}`);
  }
});

test('completion zsh script includes all subcommands', async () => {
  const { stdout } = await runCompletion(['zsh']);
  const expectedSubcommands = ['init', 'config', 'suggest', 'history', 'batch', 'completion'];
  for (const subcmd of expectedSubcommands) {
    assert.ok(stdout.includes(subcmd), `Expected stdout to contain subcommand: ${subcmd}`);
  }
});

test('completion fish script includes all subcommands', async () => {
  const { stdout } = await runCompletion(['fish']);
  const expectedSubcommands = ['init', 'config', 'suggest', 'history', 'batch', 'completion'];
  for (const subcmd of expectedSubcommands) {
    assert.ok(stdout.includes(subcmd), `Expected stdout to contain subcommand: ${subcmd}`);
  }
});

test('completion prints error and exits for unsupported shell', async () => {
  try {
    await runCompletion(['powershell']);
    assert.fail('Expected process to exit with error');
  } catch (err) {
    assert.match(err.stderr || '', /Unsupported shell/);
    assert.match(err.stderr || '', /powershell/);
  }
});

test('completion bash is case-insensitive for shell name', async () => {
  const { stdout } = await runCompletion(['BASH']);
  assert.match(stdout, /complete -F _commit_echo commit-echo/);
});

test('completion zsh is case-insensitive for shell name', async () => {
  const { stdout } = await runCompletion(['ZSH']);
  assert.match(stdout, /#compdef commit-echo/);
});

test('completion fish is case-insensitive for shell name', async () => {
  const { stdout } = await runCompletion(['FISH']);
  assert.match(stdout, /complete -c commit-echo/);
});

test('completion bash script includes global options', async () => {
  const { stdout } = await runCompletion(['bash']);
  assert.match(stdout, /--yes/);
  assert.match(stdout, /--auto/);
  assert.match(stdout, /--no-color/);
});

test('completion zsh script includes suggest subcommand options', async () => {
  const { stdout } = await runCompletion(['zsh']);
  assert.match(stdout, /--commit/);
  assert.match(stdout, /--stream/);
  assert.match(stdout, /--dry-run/);
  assert.match(stdout, /--verbose/);
});

test('completion fish script includes global options', async () => {
  const { stdout } = await runCompletion(['fish']);
  assert.match(stdout, /--yes/);
  assert.match(stdout, /--auto/);
  assert.match(stdout, /--no-color/);
});

test('completion --help shows command usage', async () => {
  const { stdout } = await runCompletion(['--help']);
  assert.match(stdout, /Usage: commit-echo completion/);
  assert.match(stdout, /Target shell: bash, zsh, or fish/);
});

test('completion bash script guards value-taking flags like --model', async () => {
  const { stdout } = await runCompletion(['bash']);
  // The bash script uses a `case` statement (not extglob) to bail out after --model
  assert.match(stdout, /case "\$\{COMP_WORDS\[COMP_CWORD-1\]\}"/);
  assert.match(stdout, /--model\) return 0/);
});

test('completion zsh script marks --model as value-taking', async () => {
  const { stdout } = await runCompletion(['zsh']);
  assert.match(stdout, /'--model\[[^\]]+\]:model:'/);
});

test('completion fish script guards value-taking flags like --model', async () => {
  const { stdout } = await runCompletion(['fish']);
  assert.match(stdout, /case '--model'/);
});

test('completion error path does not emit ANSI when --no-color is set', async () => {
  const ansiPattern = /\u001b\[[0-9;]*m/;
  try {
    await runCompletion(['powershell']);
    assert.fail('Expected process to exit with error');
  } catch (err) {
    const stderr = (err.stderr || '').toString();
    assert.match(stderr, /Unsupported shell/);
    assert.doesNotMatch(stderr, ansiPattern, 'Expected no ANSI codes with --no-color');
  }
});

test('NO_COLOR disables color even when set to an empty string (no-color.org spec)', async () => {
  // no-color.org: "Any form of the NO_COLOR environment variable ... will
  // disable color." An explicitly empty value still counts.
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const exec = promisify(execFile);
  const ansiPattern = /\u001b\[[0-9;]*m/;

  try {
    await exec(process.execPath, ['dist/index.js', '--no-color', 'completion', 'powershell'], {
      env: { ...process.env, NO_COLOR: '' },
    });
    assert.fail('Expected process to exit with error');
  } catch (err) {
    const stderr = (err.stderr || '').toString();
    assert.match(stderr, /Unsupported shell/);
    assert.doesNotMatch(stderr, ansiPattern, 'Expected no ANSI codes with NO_COLOR=""');
  }
});

test('completion bash script is syntactically valid bash', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { writeFile, unlink } = await import('node:fs/promises');
  const exec = promisify(execFile);

  const { stdout } = await runCompletion(['bash']);
  // Use a relative path in cwd — Git Bash on Windows mangles absolute Windows
  // paths (backslashes get stripped). The cwd of the test runner is the repo
  // root, which is safe because we always clean up.
  const scriptPath = `./.test-completion-${process.pid}-${Date.now()}.sh`;
  try {
    await writeFile(scriptPath, stdout, 'utf8');
    // `bash -n` parses the script without executing it
    await exec('bash', ['-n', scriptPath]);
  } finally {
    await unlink(scriptPath).catch(() => {});
  }
});

test('completion zsh script is syntactically valid zsh (if zsh is available)', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { writeFile, unlink } = await import('node:fs/promises');
  const exec = promisify(execFile);

  // Skip on platforms without zsh
  let probe;
  try {
    probe = await exec('zsh', ['-c', 'exit 0']);
  } catch {
    return; // zsh not installed — skip silently
  }
  if (probe.stderr) return;

  const { stdout } = await runCompletion(['zsh']);
  const scriptPath = `./.test-completion-${process.pid}-${Date.now()}.zsh`;
  try {
    await writeFile(scriptPath, stdout, 'utf8');
    await exec('zsh', ['-n', scriptPath]);
  } finally {
    await unlink(scriptPath).catch(() => {});
  }
});

test('completion fish script is syntactically valid fish (if fish is available)', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { writeFile, unlink } = await import('node:fs/promises');
  const exec = promisify(execFile);

  // Skip on platforms without fish
  try {
    await exec('fish', ['-c', 'exit 0']);
  } catch {
    return; // fish not installed — skip silently
  }

  const { stdout } = await runCompletion(['fish']);
  const scriptPath = `./.test-completion-${process.pid}-${Date.now()}.fish`;
  try {
    await writeFile(scriptPath, stdout, 'utf8');
    await exec('fish', ['-n', scriptPath]);
  } finally {
    await unlink(scriptPath).catch(() => {});
  }
});
