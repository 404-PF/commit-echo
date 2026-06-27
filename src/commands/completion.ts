import pc from 'picocolors';

export type SupportedShell = 'bash' | 'zsh' | 'fish';

const VALID_SHELLS: SupportedShell[] = ['bash', 'zsh', 'fish'];

/** A single subcommand option. `value` is set for options that take an argument. */
interface SubcommandOption {
  /** Long flag, including any leading dashes (e.g. `--model`). */
  flag: string;
  /** Human-readable description shown in completion tooltips. */
  description: string;
  /** When set, the option consumes the next token; completion is suppressed for that slot. */
  value?: string;
}

interface Subcommand {
  name: string;
  description: string;
  options: SubcommandOption[];
}

/**
 * Single source of truth for completion metadata. The three shell scripts are
 * generated from this structure, so adding a subcommand or option only requires
 * editing one place.
 */
const SUBCOMMANDS: readonly Subcommand[] = [
  {
    name: 'init',
    description: 'Run interactive setup wizard',
    options: [
      { flag: '--install-hook', description: 'Install a prepare-commit-msg hook in the current repository' },
      { flag: '--help', description: 'Display help for init' },
    ],
  },
  {
    name: 'config',
    description: 'View current configuration',
    options: [{ flag: '--help', description: 'Display help for config' }],
  },
  {
    name: 'suggest',
    description: 'Generate commit suggestions',
    options: [
      { flag: '--commit', description: 'Commit the selected suggestion' },
      { flag: '--yes', description: 'Automatically select the first suggestion and skip prompts' },
      { flag: '--verbose', description: 'Print diagnostic information about the suggestion request' },
      { flag: '--model', description: 'Override the configured LLM model', value: 'model' },
      { flag: '--stream', description: 'Stream suggestions as they are generated' },
      { flag: '--dry-run', description: 'Show the LLM input without generating suggestions' },
      { flag: '--no-commit', description: 'Deprecated alias' },
      { flag: '--auto', description: 'Alias for --yes' },
      { flag: '--help', description: 'Display help for suggest' },
    ],
  },
  {
    name: 'history',
    description: 'View learned style profile and recent commit history',
    options: [
      { flag: '--json', description: 'Output the style profile and recent commits as JSON' },
      { flag: '--help', description: 'Display help for history' },
    ],
  },
  {
    name: 'batch',
    description: 'Process multiple git repositories in batch mode',
    options: [
      { flag: '--recursive', description: 'Recursively search subdirectories for git repos' },
      { flag: '--yes', description: 'Automatically accept the first suggestion and commit without prompts' },
      { flag: '--auto', description: 'Alias for --yes' },
      { flag: '--help', description: 'Display help for batch' },
    ],
  },
  {
    name: 'completion',
    description: 'Generate shell completion scripts',
    options: [{ flag: '--help', description: 'Display help for completion' }],
  },
] as const;

const GLOBAL_OPTIONS: readonly SubcommandOption[] = [
  { flag: '--yes', description: 'Automatically accept the first suggestion and commit without prompts' },
  { flag: '--auto', description: 'Alias for --yes' },
  { flag: '--no-color', description: 'Disable colored output' },
  { flag: '--version', description: 'Output the version' },
  { flag: '--help', description: 'Display help' },
];

const SUBCOMMAND_NAMES: readonly string[] = SUBCOMMANDS.map((s) => s.name);
const VALUE_TAKING_FLAGS: ReadonlySet<string> = new Set(
  SUBCOMMANDS.flatMap((s) => s.options.filter((o) => o.value).map((o) => o.flag)),
);

function findSubcommand(name: string): Subcommand | undefined {
  return SUBCOMMANDS.find((s) => s.name === name);
}

/* ---------------------------------------------------------------------------
 * Bash script generation
 * ------------------------------------------------------------------------- */

function generateBashScript(): string {
  const subcommandList = [...SUBCOMMAND_NAMES, 'help'].join(' ');
  const globalOpts = GLOBAL_OPTIONS.map((o) => o.flag).join(' ');

  // Per-subcommand option cases for `merged_opts`
  const optionCases = SUBCOMMANDS.filter((s) => s.options.length > 0)
    .map(
      (s) =>
        `      ${s.name})\n        merged_opts="\${merged_opts} ${s.options.map((o) => o.flag).join(' ')}"\n        ;;`,
    )
    .join('\n');

  // Flags that consume a value; skip completion after one of these.
  const valueFlags = [...VALUE_TAKING_FLAGS].join('|');

  return `#!/usr/bin/env bash
# bash completion for commit-echo                          -*- shell-script -*-

_commit_echo()
{
  local cur commands
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  commands="${subcommandList}"

  # Global options
  global_opts="${globalOpts}"

  # Find the first non-option word as the subcommand
  local subcmd=""
  local i
  for ((i=1; i<COMP_CWORD; i++)); do
    if [[ "\${COMP_WORDS[i]}" != -* ]]; then
      subcmd="\${COMP_WORDS[i]}"
      break
    fi
  done

  # If the previous token is a flag that takes a value, don't complete
  if [[ \${COMP_CWORD} -gt 1 ]] && [[ "\${COMP_WORDS[COMP_CWORD-1]}" == @(${valueFlags}) ]]; then
    return 0
  fi

  # If no subcommand found yet, complete subcommands (or flags before any subcmd)
  if [[ -z "\${subcmd}" ]]; then
    if [[ "\${cur}" == -* ]]; then
      COMPREPLY=( $(compgen -W "\${global_opts}" -- "\${cur}") )
    else
      COMPREPLY=( $(compgen -W "\${commands}" -- "\${cur}") )
    fi
    return 0
  fi

  # If current token is a flag, merge global opts with subcommand opts
  if [[ "\${cur}" == -* ]]; then
    local merged_opts="\${global_opts}"
    case "\${subcmd}" in
${optionCases}
    esac
    COMPREPLY=( $(compgen -W "\${merged_opts}" -- "\${cur}") )
    return 0
  fi

  case "\${subcmd}" in
    completion)
      COMPREPLY=( $(compgen -W "bash zsh fish" -- "\${cur}") )
      ;;
  esac

  return 0
}

complete -F _commit_echo commit-echo
`;
}

/* ---------------------------------------------------------------------------
 * Zsh script generation
 * ------------------------------------------------------------------------- */

function generateZshScript(): string {
  const commands = SUBCOMMANDS.map((s) => `    '${s.name}:${s.description}'`).join(' \\\n');
  const globalArgs = GLOBAL_OPTIONS.map((o) => `    '${o.flag}[${o.description}]' \\`).join('\n');

  // Per-subcommand _arguments block
  const subcommandBlocks = SUBCOMMANDS.map((s) => {
    if (s.name === 'completion') {
      return `        completion)
          _arguments \\
            '--help[Display help for completion]' \\
            '1:shell:(bash zsh fish)'
          ;;`;
    }
    const optionLines = s.options
      .map((o) => {
        if (o.value) {
          return `            '${o.flag}[${o.description}]:${o.value}:' \\`;
        }
        return `            '${o.flag}[${o.description}]' \\`;
      })
      .join('\n');
    return `        ${s.name})
          _arguments \\
${optionLines}
          ;;`;
  }).join('\n');

  return `#compdef commit-echo
# zsh completion for commit-echo                           -*- shell-script -*-

_commit_echo() {
  local -a commands
  commands=(
${commands}
    'help:Display help'
  )

  _arguments -C \\
${globalArgs}
    '1:command:->command' \\
    '*::args:->args'

  case \$state in
    command)
      _describe 'command' commands
      ;;
    args)
      # Derive the first non-option argument as the subcommand
      local subcmd=''
      local w
      for w in \$words[1,-1]; do
        case \$w in
          -*) ;;
          *) subcmd=\$w; break ;;
        esac
      done
      case \$subcmd in
${subcommandBlocks}
      esac
      ;;
  esac
}

compdef _commit_echo commit-echo
`;
}

/* ---------------------------------------------------------------------------
 * Fish script generation
 * ------------------------------------------------------------------------- */

function generateFishScript(): string {
  const subcommandList = [...SUBCOMMAND_NAMES, 'help']
    .map((n) => {
      const sub = findSubcommand(n);
      const desc = sub?.description ?? 'Display help';
      return `    '${n}\\t${desc}' \\`;
    })
    .join('\n');

  const optionCases = SUBCOMMANDS.map((s) => {
    if (s.name === 'completion') {
      return `    case completion
      printf '%s\\n' \\
        '--help\\tDisplay help' \\
        'bash\\tBash completion script' \\
        'zsh\\tZsh completion script' \\
        'fish\\tFish completion script'`;
    }
    const optionLines = s.options
      .map((o) => `        '${o.flag}\\t${o.description}' \\`)
      .join('\n');
    return `    case ${s.name}
      printf '%s\\n' \\
${optionLines}`;
  }).join('\n');

  const globalFishOpts = GLOBAL_OPTIONS.map((o) => `        '${o.flag}\\t${o.description}' \\`).join('\n');

  const valueFlags = [...VALUE_TAKING_FLAGS].map((f) => `'${f}'`).join(' ');

  return `# fish completion for commit-echo                           -*- shell-script -*-

# Helper: complete options for a subcommand
function __commit_echo_complete_options
  set -l cmd (commandline -opc)
  # Find the first non-option token as the subcommand
  set -l subcmd ""
  for token in $cmd[2..-1]
    if not string match -q -- '-*' $token
      set subcmd $token
      break
    end
  end
  switch $subcmd
${optionCases}
  end
end

function __commit_echo_subcommands
  printf '%s\\n' \\
${subcommandList}
end

function __commit_echo_completions
  set -l cmd (commandline -opc)
  set -l argc (count $cmd)

  # If we are at position 1 (just the program name), suggest subcommands
  if test $argc -eq 1
    __commit_echo_subcommands
    return
  end

  # If the previous token is a flag with a value (like --model), don't complete
  switch $cmd[-1]
    case ${valueFlags}
      return
  end

  # If the current token starts with -, suggest global + subcommand options
  set -l token (commandline -ct)
  if string match -q -- '-*' $token
    # Global options
    printf '%s\\n' \\
${globalFishOpts}
    # Subcommand options
    __commit_echo_complete_options
    return
  end

  # If we have a subcommand, check if it has non-option completions
  # Find the first non-option token as the subcommand
  set -l subcmd ""
  for token in $cmd[2..-1]
    if not string match -q -- '-*' $token
      set subcmd $token
      break
    end
  end
  if test "$subcmd" = "completion"
    __commit_echo_complete_options
    return
  end

  # Otherwise, suggest subcommands (only if no subcommand selected yet)
  if test -z "$subcmd"
    __commit_echo_subcommands
  end
end

complete -c commit-echo -f -a '(__commit_echo_completions)'
`;
}

/** Returns the completion script for the given shell. */
function getCompletionScript(shell: SupportedShell): string {
  switch (shell) {
    case 'bash':
      return generateBashScript();
    case 'zsh':
      return generateZshScript();
    case 'fish':
      return generateFishScript();
  }
}

/** Returns true if color output should be enabled. */
function shouldUseColor(programArgs: readonly string[]): boolean {
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '') return false;
  if (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== '') return true;
  return !programArgs.includes('--no-color');
}

/** Prints a help message showing available shell targets. */
function printHelp(useColor: boolean): void {
  const bold = useColor ? pc.bold : (s: string) => s;
  const cyan = useColor ? pc.cyan : (s: string) => s;
  const green = useColor ? pc.green : (s: string) => s;
  const dim = useColor ? pc.dim : (s: string) => s;

  console.log(bold('Generate shell completion scripts for commit-echo.\n'));
  console.log(cyan('Usage:'));
  console.log('  commit-echo completion <shell>\n');
  console.log(cyan('Supported shells:'));
  console.log(`  ${green('bash')}   - Bash completion script`);
  console.log(`  ${green('zsh')}    - Zsh completion script`);
  console.log(`  ${green('fish')}   - Fish completion script\n`);
  console.log(cyan('Examples:'));
  console.log(`  ${dim('# Bash')}`);
  console.log('  commit-echo completion bash >> ~/.bashrc\n');
  console.log(`  ${dim('# Zsh')}`);
  console.log('  commit-echo completion zsh > ~/.zfunc/_commit-echo\n');
  console.log(`  ${dim('# Fish')}`);
  console.log('  commit-echo completion fish > ~/.config/fish/completions/commit-echo.fish');
}

/** The completion command action: outputs the requested shell script. */
export function completionCommand(shell?: string): void {
  const useColor = shouldUseColor(process.argv);

  if (!shell) {
    printHelp(useColor);
    return;
  }

  const normalized = shell.toLowerCase();

  if (!VALID_SHELLS.includes(normalized as SupportedShell)) {
    const error = `Unsupported shell: "${shell}". Supported shells: ${VALID_SHELLS.join(', ')}`;
    console.error(useColor ? pc.red(error) : error);
    process.exit(1);
  }

  process.stdout.write(getCompletionScript(normalized as SupportedShell));
}
