import pc from 'picocolors';

const BASH_SCRIPT = `#!/usr/bin/env bash
# bash completion for commit-echo                          -*- shell-script -*-

_commit_echo()
{
  local cur prev commands
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  commands="init config suggest history batch completion help"

  # Global options
  global_opts="--yes --auto --no-color --help --version"

  if [[ "\${cur}" == -* ]]; then
    COMPREPLY=( $(compgen -W "\${global_opts}" -- "\${cur}") )
    return 0
  fi

  # Find the first non-option word as the subcommand
  local subcmd=""
  local i
  for ((i=1; i<COMP_CWORD; i++)); do
    if [[ "\${COMP_WORDS[i]}" != -* ]]; then
      subcmd="\${COMP_WORDS[i]}"
      break
    fi
  done

  # If no subcommand found yet, complete subcommands
  if [[ -z "\${subcmd}" ]]; then
    COMPREPLY=( $(compgen -W "\${commands}" -- "\${cur}") )
    return 0
  fi

  case "\${subcmd}" in
    suggest)
      local suggest_opts="--commit --yes --verbose --model --stream --dry-run --no-commit --auto --help"
      if [[ "\${cur}" == -* ]]; then
        COMPREPLY=( $(compgen -W "\${suggest_opts}" -- "\${cur}") )
      fi
      ;;
    history)
      local history_opts="--json --help"
      if [[ "\${cur}" == -* ]]; then
        COMPREPLY=( $(compgen -W "\${history_opts}" -- "\${cur}") )
      fi
      ;;
    batch)
      local batch_opts="--recursive --yes --auto --help"
      if [[ "\${cur}" == -* ]]; then
        COMPREPLY=( $(compgen -W "\${batch_opts}" -- "\${cur}") )
      fi
      ;;
    init)
      local init_opts="--install-hook --help"
      if [[ "\${cur}" == -* ]]; then
        COMPREPLY=( $(compgen -W "\${init_opts}" -- "\${cur}") )
      fi
      ;;
    completion)
      local completion_opts="--help"
      if [[ "\${cur}" == -* ]]; then
        COMPREPLY=( $(compgen -W "\${completion_opts}" -- "\${cur}") )
      else
        COMPREPLY=( $(compgen -W "bash zsh fish" -- "\${cur}") )
      fi
      ;;
  esac

  return 0
}

complete -F _commit_echo commit-echo
`;

const ZSH_SCRIPT = `#compdef commit-echo
# zsh completion for commit-echo                           -*- shell-script -*-

_commit_echo() {
  local -a commands
  commands=(
    'init:Run interactive setup wizard'
    'config:View current configuration'
    'suggest:Generate commit suggestions'
    'history:View learned style profile and recent commit history'
    'batch:Process multiple git repositories in batch mode'
    'completion:Generate shell completion scripts'
  )

  _arguments -C \\
    '--yes[Automatically accept the first suggestion and commit without prompts]' \\
    '--auto[Alias for --yes]' \\
    '--no-color[Disable colored output]' \\
    '--version[Output the version]' \\
    '--help[Display help]' \\
    '1:command:->command' \\
    '*::args:->args'

  case \$state in
    command)
      _describe 'command' commands
      ;;
    args)
      case \$words[1] in
        suggest)
          _arguments \\
            '--commit[Commit the selected suggestion]' \\
            '--yes[Automatically select the first suggestion and skip prompts]' \\
            '--verbose[Print diagnostic information about the suggestion request]' \\
            '--model[Override the configured LLM model]:model:' \\
            '--stream[Stream suggestions as they are generated]' \\
            '--dry-run[Show the LLM input without generating suggestions]' \\
            '--no-commit[Deprecated alias]' \\
            '--auto[Alias for --yes]' \\
            '--help[Display help for suggest]'
          ;;
        history)
          _arguments \\
            '--json[Output the style profile and recent commits as JSON]' \\
            '--help[Display help for history]'
          ;;
        batch)
          _arguments \\
            '--recursive[Recursively search subdirectories for git repos]' \\
            '--yes[Automatically accept the first suggestion and commit without prompts]' \\
            '--auto[Alias for --yes]' \\
            '--help[Display help for batch]'
          ;;
        init)
          _arguments \\
            '--install-hook[Install a prepare-commit-msg hook in the current repository]' \\
            '--help[Display help for init]'
          ;;
        completion)
          _arguments \\
            '--help[Display help for completion]' \\
            '1:shell:(bash zsh fish)'
          ;;
      esac
      ;;
  esac
}

_compdef _commit_echo commit-echo
`;

const FISH_SCRIPT = `# fish completion for commit-echo                           -*- shell-script -*-

# Helper: complete options for a subcommand
function __commit_echo_complete_options
  set -l cmd (commandline -opc)
  set -l subcmd $cmd[2]
  switch $subcmd
    case suggest
      printf '%s\\t%s\\n' \\
        '--commit\\tCommit the selected suggestion' \\
        '--yes\\tAutomatically select the first suggestion' \\
        '--verbose\\tPrint diagnostic information' \\
        '--model\\tOverride the configured LLM model' \\
        '--stream\\tStream suggestions as they are generated' \\
        '--dry-run\\tShow the LLM input without generating suggestions' \\
        '--no-commit\\tDeprecated alias' \\
        '--auto\\tAlias for --yes' \\
        '--help\\tDisplay help'
    case history
      printf '%s\\t%s\\n' \\
        '--json\\tOutput the style profile and recent commits as JSON' \\
        '--help\\tDisplay help'
    case batch
      printf '%s\\t%s\\n' \\
        '--recursive\\tRecursively search subdirectories for git repos' \\
        '--yes\\tAutomatically accept the first suggestion and commit without prompts' \\
        '--auto\\tAlias for --yes' \\
        '--help\\tDisplay help'
    case init
      printf '%s\\t%s\\n' \\
        '--install-hook\\tInstall a prepare-commit-msg hook' \\
        '--help\\tDisplay help'
    case completion
      printf '%s\\t%s\\n' \\
        '--help\\tDisplay help' \\
        'bash\\tBash completion script' \\
        'zsh\\tZsh completion script' \\
        'fish\\tFish completion script'
  end
end

function __commit_echo_subcommands
  printf '%s\\t%s\\n' \\
    'init\\tRun interactive setup wizard' \\
    'config\\tView current configuration' \\
    'suggest\\tGenerate commit suggestions' \\
    'history\\tView learned style profile and history' \\
    'batch\\tProcess multiple git repositories' \\
    'completion\\tGenerate shell completion scripts' \\
    'help\\tDisplay help'
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
    case '--model'
      return
  end

  # If the current token starts with -, suggest global + subcommand options
  set -l token (commandline -ct)
  if string match -q -- '-*' $token
    # Global options
    printf '%s\\t%s\\n' \\
      '--yes\\tAutomatically accept the first suggestion' \\
      '--auto\\tAlias for --yes' \\
      '--no-color\\tDisable colored output' \\
      '--version\\tOutput the version' \\
      '--help\\tDisplay help'
    # Subcommand options
    __commit_echo_complete_options
    return
  end

  # If we have a subcommand, check if it has non-option completions
  set -l subcmd $cmd[2]
  if test "$subcmd" = "completion"
    __commit_echo_complete_options
    return
  end

  # Otherwise, suggest subcommands
  __commit_echo_subcommands
end

complete -c commit-echo -f -a '(__commit_echo_completions)'
`;

export type SupportedShell = 'bash' | 'zsh' | 'fish';

const VALID_SHELLS: SupportedShell[] = ['bash', 'zsh', 'fish'];

/** Returns the completion script for the given shell. */
function getCompletionScript(shell: SupportedShell): string {
  switch (shell) {
    case 'bash':
      return BASH_SCRIPT;
    case 'zsh':
      return ZSH_SCRIPT;
    case 'fish':
      return FISH_SCRIPT;
  }
}

/** Prints a help message showing available shell targets. */
function printHelp(): void {
  console.log(pc.bold('Generate shell completion scripts for commit-echo.\n'));
  console.log(pc.cyan('Usage:'));
  console.log('  commit-echo completion <shell>\n');
  console.log(pc.cyan('Supported shells:'));
  console.log(`  ${pc.green('bash')}   - Bash completion script`);
  console.log(`  ${pc.green('zsh')}    - Zsh completion script`);
  console.log(`  ${pc.green('fish')}   - Fish completion script\n`);
  console.log(pc.cyan('Examples:'));
  console.log(`  ${pc.dim('# Bash')}`);
  console.log('  commit-echo completion bash >> ~/.bashrc\n');
  console.log(`  ${pc.dim('# Zsh')}`);
  console.log('  commit-echo completion zsh > ~/.zfunc/_commit-echo\n');
  console.log(`  ${pc.dim('# Fish')}`);
  console.log('  commit-echo completion fish > ~/.config/fish/completions/commit-echo.fish');
}

/** The completion command action: outputs the requested shell script. */
export function completionCommand(shell?: string): void {
  if (!shell) {
    printHelp();
    return;
  }

  const normalized = shell.toLowerCase() as SupportedShell;

  if (!VALID_SHELLS.includes(normalized)) {
    console.error(pc.red(`Unsupported shell: "${shell}". Supported shells: ${VALID_SHELLS.join(', ')}`));
    process.exit(1);
  }

  process.stdout.write(getCompletionScript(normalized));
}
