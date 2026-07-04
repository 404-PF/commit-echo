import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { unlink, writeFile } from 'node:fs/promises';
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
  const expectedSubcommands = ['init', 'config', 'suggest', 'history', 'batch', 'completion', 'help'];
  for (const subcmd of expectedSubcommands) {
    assert.ok(stdout.includes(subcmd), `Expected stdout to contain subcommand: ${subcmd}`);
  }
});

test('completion zsh script includes all subcommands', async () => {
  const { stdout } = await runCompletion(['zsh']);
  const expectedSubcommands = ['init', 'config', 'suggest', 'history', 'batch', 'completion', 'help'];
  for (const subcmd of expectedSubcommands) {
    assert.ok(stdout.includes(subcmd), `Expected stdout to contain subcommand: ${subcmd}`);
  }
});

test('completion fish script includes all subcommands', async () => {
  const { stdout } = await runCompletion(['fish']);
  const expectedSubcommands = ['init', 'config', 'suggest', 'history', 'batch', 'completion', 'help'];
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
  // All suggest options (long forms) must be present
  // so that tab-completion covers every flag the CLI accepts.
  const expected = [
    '--commit',
    '--yes',
    '--verbose',
    '--show-diff',
    '--model',
    '--max-diff-size',
    '--stream',
    '--dry-run',
    '--no-commit',
    '--auto',
    '--help',
  ];
  for (const opt of expected) {
    assert.ok(stdout.includes(`'${opt}[`), `Expected zsh script to include option: ${opt}`);
  }
  // And the value-taking markers
  assert.match(stdout, /'--model\[[^\]]+\]:model:'/);
  assert.match(stdout, /'--max-diff-size\[[^\]]+\]:n:'/);
});

test('completion fish script includes global options', async () => {
  const { stdout } = await runCompletion(['fish']);
  assert.match(stdout, /--yes/);
  assert.match(stdout, /--auto/);
  assert.match(stdout, /--no-color/);
});

test('completion fish script includes suggest subcommand options', async () => {
  const { stdout } = await runCompletion(['fish']);
  const expected = [
    '--commit',
    '--yes',
    '--verbose',
    '--show-diff',
    '--model',
    '--max-diff-size',
    '--stream',
    '--dry-run',
    '--no-commit',
    '--auto',
    '--help',
  ];
  for (const opt of expected) {
    assert.ok(stdout.includes(`"${opt}\\t`), `Expected fish script to include option: ${opt}`);
  }
});

test('completion --help shows command usage', async () => {
  const { stdout } = await runCompletion(['--help']);
  assert.match(stdout, /Usage: commit-echo completion/);
  assert.match(stdout, /Target shell: bash, zsh, or fish/);
});

test('completion bash script includes short flag aliases', async () => {
  const { stdout } = await runCompletion(['bash']);
  // Short aliases for suggest: -y, -v, -d, -m, -n
  assert.match(stdout, /-y/);
  assert.match(stdout, /-v/);
  assert.match(stdout, /-d/);
  assert.match(stdout, /-m/);
  // Short alias for batch: -r
  assert.match(stdout, /-r/);
});

test('completion zsh script includes short flag aliases', async () => {
  const { stdout } = await runCompletion(['zsh']);
  // Zsh emits short forms as separate specs: `'-y[desc]'` for boolean flags
  // and `'-m[desc]:model:'` for value-taking flags.
  assert.match(stdout, /'-y\[/);
  assert.match(stdout, /'-y\[[^\]]+\]'/);
  assert.match(stdout, /'-d\[/);
  assert.match(stdout, /'-m\[/);
  assert.match(stdout, /'-m\[[^\]]+\]:model:'/);
});

test('completion fish script includes short flag aliases', async () => {
  const { stdout } = await runCompletion(['fish']);
  // Fish prints both forms as separate `printf` lines under the subcommand case.
  assert.match(stdout, /"-y\\t/);
  assert.match(stdout, /"-v\\t/);
  assert.match(stdout, /"-d\\t/);
  assert.match(stdout, /"-m\\t/);
});

test('completion scripts suggest shell names for the completion subcommand', async () => {
  // Bash: compgen -W "bash zsh fish" in the completion case
  const { stdout: bashScript } = await runCompletion(['bash']);
  assert.match(bashScript, /completion\)[\s\S]*compgen -W.*bash.*zsh.*fish/);
  // Zsh: '1:shell:(bash zsh fish)' positional arg
  const { stdout: zshScript } = await runCompletion(['zsh']);
  assert.match(zshScript, /'1:shell:\(bash zsh fish\)'/);
  // Fish: printf lines for each shell name in the completion case
  const { stdout: fishScript } = await runCompletion(['fish']);
  assert.match(fishScript, /case completion[\s\S]*"bash\\t/);
  assert.match(fishScript, /case completion[\s\S]*"zsh\\t/);
  assert.match(fishScript, /case completion[\s\S]*"fish\\t/);
});

test('completion bash script handles --flag=value glued form', async () => {
  const { stdout } = await runCompletion(['bash']);
  // After a value-taking flag in `--flag=value` form, completion should also bail out.
  assert.match(stdout, /--model=\*\) return 0/);
  assert.match(stdout, /--max-diff-size=\*\) return 0/);
});

test('completion bash script guards value-taking flags like --model', async () => {
  const { stdout } = await runCompletion(['bash']);
  // The bash script uses a `case` statement (not extglob) to bail out after value-taking flags.
  assert.match(stdout, /case "\$\{COMP_WORDS\[COMP_CWORD-1\]\}"/);
  assert.match(stdout, /--model\) return 0/);
  assert.match(stdout, /--max-diff-size\) return 0/);
});

test('completion zsh script marks --model as value-taking', async () => {
  const { stdout } = await runCompletion(['zsh']);
  assert.match(stdout, /'--model\[[^\]]+\]:model:'/);
  assert.match(stdout, /'--max-diff-size\[[^\]]+\]:n:'/);
});

test('completion fish script guards value-taking flags like --model', async () => {
  const { stdout } = await runCompletion(['fish']);
  // The fish script guards both the long and short forms, plus the glued --flag=value form.
  assert.match(stdout, /case '.*--model'.*'--model=\*'.*'--max-diff-size'.*'--max-diff-size=\*'/);
  assert.match(stdout, /'-m'/);
  assert.match(stdout, /'-m=\*'/);
});

test('completion fish script suggests global options when typing flags before subcommand', async () => {
  const { stdout } = await runCompletion(['fish']);
  // When no subcommand is selected and the user types a flag like "--y",
  // the fish script should suggest global options (--yes, --auto, --no-color)
  // instead of falling through to suggest subcommands. The script achieves this
  // by checking for flag tokens in the empty-subcmd branch.
  assert.match(stdout, /if test -z "\$subcmd"[\s\S]*if string match -q -- '-\*' \$token/);
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
  const ansiPattern = /\u001b\[[0-9;]*m/;

  try {
    await execFileAsync(process.execPath, ['dist/index.js', '--no-color', 'completion', 'powershell'], {
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
  const { stdout } = await runCompletion(['bash']);
  // Use a relative path in cwd — Git Bash on Windows mangles absolute Windows
  // paths (backslashes get stripped). The cwd of the test runner is the repo
  // root, which is safe because we always clean up.
  const scriptPath = `./.test-completion-${process.pid}-${Date.now()}.sh`;
  try {
    await writeFile(scriptPath, stdout, 'utf8');
    // `bash -n` parses the script without executing it
    await execFileAsync('bash', ['-n', scriptPath]);
  } finally {
    await unlink(scriptPath).catch(() => {});
  }
});

test('completion zsh script is syntactically valid zsh (if zsh is available)', async () => {
  // Skip on platforms without zsh
  let probe;
  try {
    probe = await execFileAsync('zsh', ['-c', 'exit 0']);
  } catch {
    return; // zsh not installed — skip silently
  }
  if (probe.stderr) return;

  const { stdout } = await runCompletion(['zsh']);
  const scriptPath = `./.test-completion-${process.pid}-${Date.now()}.zsh`;
  try {
    await writeFile(scriptPath, stdout, 'utf8');
    await execFileAsync('zsh', ['-n', scriptPath]);
  } finally {
    await unlink(scriptPath).catch(() => {});
  }
});

test('completion fish script is syntactically valid fish (if fish is available)', async () => {
  // Skip on platforms without fish
  try {
    await execFileAsync('fish', ['-c', 'exit 0']);
  } catch {
    return; // fish not installed — skip silently
  }

  const { stdout } = await runCompletion(['fish']);
  const scriptPath = `./.test-completion-${process.pid}-${Date.now()}.fish`;
  try {
    await writeFile(scriptPath, stdout, 'utf8');
    await execFileAsync('fish', ['-n', scriptPath]);
  } finally {
    await unlink(scriptPath).catch(() => {});
  }
});

test('completion zsh script skips _arguments for subcommands with no options', async () => {
  const { stdout } = await runCompletion(['zsh']);
  // The `help` subcommand has no options, so it should not have a dangling
  // `_arguments \` continuation. Instead it should be a bare `help)\n;;`.
  assert.match(stdout, /help\)\n\s+;;/);
  assert.doesNotMatch(stdout, /help\)\n\s+_arguments/);
});

test('completion scripts contain all options from every subcommand help', async () => {
  // `hook` is intentionally excluded: it is hidden (invoked by Git, not humans)
  // and registered with `{ hidden: true }` in Commander, so it has no --help output.
  const subcommands = ['init', 'config', 'suggest', 'history', 'batch', 'completion'];
  const allHelpFlags = new Set();

  // Collect --long flags from root help (global options)
  const { stdout: rootHelp } = await execFileAsync(process.execPath, [
    'dist/index.js',
    '--no-color',
    '--help',
  ], { env: { ...process.env, NO_COLOR: '1' } });
  for (const flag of rootHelp.match(/--[\w-]+/g) || []) allHelpFlags.add(flag);

  // Collect --long flags from each subcommand's help
  for (const subcmd of subcommands) {
    const { stdout: subHelp } = await execFileAsync(process.execPath, [
      'dist/index.js',
      '--no-color',
      subcmd,
      '--help',
    ], { env: { ...process.env, NO_COLOR: '1' } });
    for (const flag of subHelp.match(/--[\w-]+/g) || []) allHelpFlags.add(flag);
  }

  // Get completion scripts
  const { stdout: bashScript } = await runCompletion(['bash']);
  const { stdout: zshScript } = await runCompletion(['zsh']);
  const { stdout: fishScript } = await runCompletion(['fish']);

  // Every flag shown in any --help output must appear in all three scripts.
  // If this test fails, update SUBCOMMANDS in src/commands/completion.ts.
  for (const flag of allHelpFlags) {
    assert.ok(bashScript.includes(flag), `Bash completion missing ${flag}`);
    assert.ok(zshScript.includes(flag), `Zsh completion missing ${flag}`);
    assert.ok(fishScript.includes(flag), `Fish completion missing ${flag}`);
  }
});
