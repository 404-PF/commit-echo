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
    assert.match(stdout, new RegExp(subcmd));
  }
});

test('completion zsh script includes all subcommands', async () => {
  const { stdout } = await runCompletion(['zsh']);
  const expectedSubcommands = ['init', 'config', 'suggest', 'history', 'batch', 'completion'];
  for (const subcmd of expectedSubcommands) {
    assert.match(stdout, new RegExp(subcmd));
  }
});

test('completion fish script includes all subcommands', async () => {
  const { stdout } = await runCompletion(['fish']);
  const expectedSubcommands = ['init', 'config', 'suggest', 'history', 'batch', 'completion'];
  for (const subcmd of expectedSubcommands) {
    assert.match(stdout, new RegExp(subcmd));
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
