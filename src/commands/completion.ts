import pc from 'picocolors';

export type SupportedShell = 'bash' | 'zsh' | 'fish';

const VALID_SHELLS: readonly SupportedShell[] = ['bash', 'zsh', 'fish'];

/** A single subcommand option. `value` is set for options that take an argument. */
interface SubcommandOption {
  /** Long flag, including any leading dashes (e.g. `--model`). */
  flag: string;
  /** Optional short alias, including leading dashes (e.g. `-m`). */
  short?: string;
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
 *
 * **Sync requirement**: this array must mirror the Commander definitions in
 * `src/index.ts`. When adding or changing a subcommand or option in the CLI,
 * update this array at the same time. The test
 * "completion scripts contain all options from every subcommand help" catches
 * drift by comparing each subcommand's --help output against the generated
 * scripts.
 *
 * Note: the `hook` subcommand is registered on the root program (see
 * src/index.ts) with `{ hidden: true }` because it is invoked by Git, not
 * humans. It is intentionally omitted from completion so users do not see it.
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
      { flag: '--yes', short: '-y', description: 'Automatically select the first suggestion and skip prompts' },
      { flag: '--verbose', short: '-v', description: 'Print diagnostic information about the suggestion request' },
      { flag: '--show-diff', short: '-d', description: 'Print the diff content that will be sent to the LLM' },
      { flag: '--model', short: '-m', description: 'Override the configured LLM model', value: 'model' },
      { flag: '--max-diff-size', description: 'Override the configured maximum diff size', value: 'n' },
      { flag: '--stream', description: 'Stream suggestions as they are generated' },
      { flag: '--dry-run', short: '-n', description: 'Show the LLM input without generating suggestions' },
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
      { flag: '--recursive', short: '-r', description: 'Recursively search subdirectories for git repos' },
      { flag: '--yes', short: '-y', description: 'Automatically accept the first suggestion and commit without prompts' },
      { flag: '--auto', description: 'Alias for --yes' },
      { flag: '--help', description: 'Display help for batch' },
    ],
  },
  {
    name: 'completion',
    description: 'Generate shell completion scripts',
    options: [{ flag: '--help', description: 'Display help for completion' }],
  },
  {
    name: 'help',
    description: 'Display help for a command',
    options: [],
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
const SHELL_NAMES_LIST: string = VALID_SHELLS.join(' ');
const VALUE_TAKING_FLAGS: ReadonlySet<string> = new Set(
  SUBCOMMANDS.flatMap((s) => s.options.filter((o) => o.value).map((o) => o.flag)),
);

/** Returns all flag forms (short + long) for an option, long form first. */
function allFlags(o: SubcommandOption): string[] {
  return o.short ? [o.flag, o.short] : [o.flag];
}

/** Escapes single quotes for safe use inside zsh single-quoted strings. */
function zshEscape(s: string): string {
  return s.replace(/'/g, "'\\''");
}

/** Joins lines with ` \\` continuation, omitting the trailing backslash on the last line. */
function joinContinuationLines(lines: string[]): string {
  if (lines.length <= 1) return lines.join('');
  return lines.slice(0, -1).map((l) => `${l} \\`).join('\n') + '\n' + lines[lines.length - 1];
}

/* ---------------------------------------------------------------------------
 * Bash script generation
 * ------------------------------------------------------------------------- */

/** Generates a bash completion script using `complete -F` with per-subcommand option cases. */
function generateBashScript(): string {
  const subcommandList = [...SUBCOMMAND_NAMES].join(' ');
  const globalOpts = GLOBAL_OPTIONS.map((o) => allFlags(o).join(' ')).join(' ');

  // Per-subcommand option cases for `merged_opts` (long + short forms).
  const optionCases = SUBCOMMANDS.filter((s) => s.options.length > 0)
    .map(
      (s) =>
        `      ${s.name})\n        merged_opts="\${merged_opts} ${s.options.map((o) => allFlags(o).join(' ')).join(' ')}"\n        ;;`,
    )
    .join('\n');

  // Flags that consume a value; skip completion after one of these.
  // Rendered as a `case` pattern list so we don't depend on extglob.
  // Also match the glued form: `--model=gpt-4` (anything after `=` is the value).
  const valueFlagCases = [...VALUE_TAKING_FLAGS]
    .flatMap((f) => [`${f}) return 0 ;;`, `${f}=*) return 0 ;;`])
    .map((line) => `    ${line}`)
    .join('\n');

  return `#!/usr/bin/env bash
# bash completion for commit-echo                          -*- shell-script -*-

_commit_echo()
{
  local cur commands
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  commands="${subcommandList}"

  # Global options
  local global_opts="${globalOpts}"

  # Find the first non-option word as the subcommand
  local subcmd=""
  local i
  for ((i=1; i<COMP_CWORD; i++)); do
    if [[ "\${COMP_WORDS[i]}" != -* ]]; then
      subcmd="\${COMP_WORDS[i]}"
      break
    fi
  done

  # Track whether a non-option arg already follows the subcommand
  local has_positional=0
  if [[ -n "\${subcmd}" ]]; then
    local j
    for ((j=i+1; j<COMP_CWORD; j++)); do
      if [[ "\${COMP_WORDS[j]}" != -* ]]; then
        has_positional=1
        break
      fi
    done
  fi

  # If the previous token is a flag that takes a value, don't complete.
  # Using case (not extglob) so the script works regardless of extglob state.
  # Also handles the glued --flag=value form.
  if [[ \${COMP_CWORD} -gt 1 ]]; then
    case "\${COMP_WORDS[COMP_CWORD-1]}" in
${valueFlagCases}
    esac
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
    batch)
      if [[ \${has_positional} -eq 0 ]]; then
        COMPREPLY=( $(compgen -d -- "\${cur}") )
      fi
      ;;
    completion)
      COMPREPLY=( $(compgen -W "${SHELL_NAMES_LIST}" -- "\${cur}") )
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

/** Generates a zsh completion script using `#compdef` and `_arguments` with subcommand dispatch. */
function generateZshScript(): string {
  // Subcommand list rendered as `name:description` pairs for `_describe`.
  const commands = SUBCOMMANDS.map((s) => `    '${s.name}:${zshEscape(s.description)}'`).join(' \\\n');
  // Global flags available before any subcommand. Zsh supports multiple specs
  // per option, so short and long forms can be listed together: `-y[...]:--yes`.
  const globalArgs = GLOBAL_OPTIONS.flatMap((o) => {
    const specs = [`    '${o.flag}[${zshEscape(o.description)}]'`];
    if (o.short) specs.push(`    '${o.short}[${zshEscape(o.description)}]'`);
    return specs;
  }).join(' \\\n');

  // Per-subcommand _arguments block (emitted into the `args` state below).
  const subcommandBlocks = SUBCOMMANDS.map((s) => {
    const optionLines = s.options
      .map((o) => {
        const valuePart = o.value ? `:${o.value}:` : '';
        if (o.short) {
          const shortValuePart = o.value ? `:${o.value}:` : '';
          return `            '${o.short}[${zshEscape(o.description)}]${shortValuePart}' \\\n            '${o.flag}[${zshEscape(o.description)}]${valuePart}' \\`;
        }
        return `            '${o.flag}[${zshEscape(o.description)}]${valuePart}' \\`;
      })
      .join('\n');
    // The completion subcommand takes a positional shell argument.
    // The batch subcommand takes an optional directory argument.
    const positionalArg =
      s.name === 'completion'
        ? ` \\\n            '1:shell:(${SHELL_NAMES_LIST})'`
        : s.name === 'batch'
          ? ` \\\n            '1::directory:_files -/'`
          : '';
    // Skip _arguments entirely when there are no options and no positional arg.
    if (!optionLines && !positionalArg) {
      return `        ${s.name})
          ;;
`;
    }
    return `        ${s.name})
          _arguments \\
${optionLines}${positionalArg}
          ;;`;
  }).join('\n');

  return `#compdef commit-echo
# zsh completion for commit-echo                           -*- shell-script -*-

_commit_echo() {
  local -a commands
  commands=(
${commands}
  )

  # Two-state completion machine:
  #   - command state: offer the top-level subcommand list.
  #   - args state: dispatch into the per-subcommand _arguments block.
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

/** Generates a fish completion script using `complete -c` with helper functions for subcommands and options. */
function generateFishScript(): string {
  const subcommandListLines = SUBCOMMANDS.map(
    (s) => `    "${s.name}\\t${s.description}"`,
  );
  const subcommandList =
    subcommandListLines.slice(0, -1).map((l) => `${l} \\`).join('\n') +
    '\n' +
    subcommandListLines[subcommandListLines.length - 1];

  const optionCases = SUBCOMMANDS.map((s) => {
    const rawOptionLines = s.options.flatMap((o) => {
      const lines = [`        "${o.flag}\\t${o.description}"`];
      if (o.short) lines.push(`        "${o.short}\\t${o.description}"`);
      return lines;
    });
    // The completion subcommand offers shell names as positional completions.
    if (s.name === 'completion') {
      for (const sh of VALID_SHELLS) {
        rawOptionLines.push(`        "${sh}\\t${sh} completion script"`);
      }
    }
    const joined = joinContinuationLines(rawOptionLines);
    return `    case ${s.name}
      printf "%s\\n" \\
${joined}`;
  }).join('\n');

  const globalFishOptsLines = GLOBAL_OPTIONS.flatMap((o) => {
    const lines = [`        "${o.flag}\\t${o.description}"`];
    if (o.short) lines.push(`        "${o.short}\\t${o.description}"`);
    return lines;
  });
  const globalFishOpts = joinContinuationLines(globalFishOptsLines);

  // Value-taking flags, with their short forms (if any) and the glued
  // --flag=value form. We also include each short form (e.g. '-m') so that
  // 'commit-echo suggest -m <TAB>' doesn't try to complete the model value.
  const valueFlagPatterns = [...VALUE_TAKING_FLAGS].flatMap((f) => {
    const opt = SUBCOMMANDS.flatMap((s) => s.options).find((o) => o.flag === f);
    const forms = opt?.short ? [opt.short, f] : [f];
    return forms.flatMap((form) => [form, `${form}=*`]);
  });
  const valueFlags = valueFlagPatterns.map((f) => `'${f}'`).join(' ');

  return `# fish completion for commit-echo                           -*- shell-script -*-

# Helper: complete options for a given subcommand
function __commit_echo_complete_options
  set -l subcmd $argv[1]
  switch $subcmd
${optionCases}
  end
end

function __commit_echo_subcommands
  printf "%s\\n" \\
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

  # Find the first non-option token as the subcommand
  set -l subcmd ""
  for token in $cmd[2..-1]
    if not string match -q -- '-*' $token
      set subcmd $token
      break
    end
  end

  # If no subcommand selected yet, suggest subcommands or global options
  set -l token (commandline -ct)
  if test -z "$subcmd"
    if string match -q -- '-*' $token
      printf "%s\\n" \\
${globalFishOpts}
    else
      __commit_echo_subcommands
    end
    return
  end

  # If the current token starts with -, suggest global + subcommand options
  if string match -q -- '-*' $token
    # Global options
    printf "%s\\n" \\
${globalFishOpts}
    # Subcommand options
    __commit_echo_complete_options $subcmd
    return
  end

  # If we have a subcommand with non-option completions, delegate
  if test "$subcmd" = "completion"
    __commit_echo_complete_options $subcmd
  end
  if test "$subcmd" = "batch"
    set -l has_positional 0
    set -l found_subcmd 0
    for token in $cmd[2..-1]
      if test $found_subcmd -eq 0
        if not string match -q -- '-*' $token
          set found_subcmd 1
        end
      else
        if not string match -q -- '-*' $token
          set has_positional 1
          break
        end
      end
    end
    if test $has_positional -eq 0
      __fish_complete_directories
    end
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

/** Type guard: returns true if `s` is a supported shell name. */
function isSupportedShell(s: string): s is SupportedShell {
  return (VALID_SHELLS as readonly string[]).includes(s);
}

/**
 * Returns true if color output should be enabled.
 *
 * Follows the de-facto CLI convention: `NO_COLOR` (any value, including empty)
 * disables color per https://no-color.org/; `FORCE_COLOR` (any value) forces
 * it on; otherwise, the `--no-color` CLI flag is honored.
 */
function shouldUseColor(argv: readonly string[]): boolean {
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.FORCE_COLOR !== undefined) return true;
  return !argv.includes('--no-color');
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
  console.log(`  ${dim('# Bash (system-wide, recommended)')}`);
  console.log('  sudo commit-echo completion bash > /etc/bash_completion.d/commit-echo\n');
  console.log(`  ${dim('# Bash (per-user, requires bash-completion on PATH)')}`);
  console.log('  commit-echo completion bash > ~/.local/share/bash-completion/completions/commit-echo\n');
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

  if (!isSupportedShell(normalized)) {
    const error = `Unsupported shell: "${shell}". Supported shells: ${VALID_SHELLS.join(', ')}`;
    console.error(useColor ? pc.red(error) : error);
    process.exit(1);
  }

  process.stdout.write(getCompletionScript(normalized));
}
