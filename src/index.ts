#!/usr/bin/env node

import { Command } from 'commander';
import pc from 'picocolors';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initCommand } from './commands/init.js';
import { suggestCommand } from './commands/suggest.js';
import { historyCommand } from './commands/history.js';
import { configCommand, configSetCommand } from './commands/config.js';
import { batchCommand } from './commands/batch.js';
import { completionCommand } from './commands/completion.js';
import { getAvailableTemplateVars } from './llm/prompt.js';
import { runPostCommitHook, runPrepareCommitMsgHook } from './git/hook.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
let pkg: { version?: string; description?: string };
try {
  pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
} catch {
  pkg = { version: '0.1.0', description: '' };
}

const program = new Command();
program
  .option('-y, --yes', 'Automatically accept the first suggestion and commit without prompts')
  .option('--auto', 'Alias for --yes')
  .option('--no-color', 'Disable colored output');

program
  .name('commit-echo')
  .version(pkg.version ?? '0.1.0')
  .description(pkg.description ?? 'LLM-powered Git commit message assistant')
  .addHelpText(
    'after',
    `
${pc.dim('Examples:')}
  ${pc.cyan('commit-echo')}           Suggest and commit staged changes
  ${pc.cyan('commit-echo --yes')}       Auto-select and commit first suggestion
  ${pc.cyan('commit-echo init')}      Run interactive setup wizard
  ${pc.cyan('commit-echo config')}    View current configuration
  ${pc.cyan('commit-echo config --json')} Output configuration as JSON
  ${pc.cyan('commit-echo suggest')}    Generate suggestions without committing
  ${pc.cyan('commit-echo suggest --yes')} Auto-select first suggestion (no commit)
  ${pc.cyan('commit-echo history')}   View learned style profile and history
  ${pc.cyan('commit-echo history --json')} Output learned history data as JSON
  ${pc.cyan('commit-echo batch')}     Process all git repos in current directory
  ${pc.cyan('commit-echo batch --recursive')} Search subdirectories for repos
  ${pc.cyan('commit-echo batch --yes')} Auto-commit repos with staged changes
  ${pc.cyan('commit-echo completion')} Generate shell completion scripts

${pc.dim('Custom prompt template variables:')}
  ${getAvailableTemplateVars()
    .split('\n')
    .map((l) => `  ${pc.dim(l)}`)
    .join('\n')}
  ${pc.dim('Set systemPromptTemplate / userPromptTemplate in config.json')}
`,
  );

program
  .command('init')
  .description('Run interactive setup wizard to configure provider and model')
  .option('--install-hook', 'Install a prepare-commit-msg hook in the current repository')
  .action(async (options) => {
    await initCommand({ installHook: Boolean(options.installHook) });
  });

const configCliCommand = program
  .command('config')
  .description('View current configuration')
  .option('--json', 'Output the configuration as JSON')
  .action(async (options) => {
    await configCommand({ json: Boolean(options.json) });
  });

configCliCommand
  .command('set')
  .description('Update one configuration value. Warning: values such as apiKey may be visible in shell history.')
  .argument('<key>', 'Configuration key to update')
  .argument('<value>', 'New value')
  .addHelpText(
    'after',
    `\n${pc.yellow('Security note:')} Passing ${pc.cyan('apiKey')} on the command line may expose it via shell history or process inspection. Prefer ${pc.cyan('commit-echo init')} or environment variables for secrets.`,
  )
  .action(async (key: string, value: string) => {
    await configSetCommand(key, value);
  });

program
  .command('suggest')
  .description('Generate commit suggestions (use --commit to create a commit)')
  .option('--commit', 'Commit the selected suggestion', false)
  .option('-y, --yes', 'Automatically select the first suggestion and skip prompts')
  .option('-v, --verbose', 'Print diagnostic information about the suggestion request')
  .option('-d, --show-diff', 'Print the diff content that will be sent to the LLM')
  .option('-m, --model <model>', 'Override the configured LLM model for this invocation')
  .option('--max-diff-size <n>', 'Override the configured maximum diff size for this invocation')
  .option('--stream', 'Stream suggestions as they are generated (progressive output)')
  .option('-n, --dry-run', 'Show the LLM input without generating suggestions')
  .option('--no-commit', 'Deprecated alias; suggest already skips committing unless --commit is passed')
  .option('--auto', 'Alias for --yes')
  .action(async (options) => {
    const globalOpts = program.opts<{ yes?: boolean; auto?: boolean }>();
    await suggestCommand({
      commit: options.commit,
      autoCommit: Boolean(options.yes || options.auto || globalOpts.yes || globalOpts.auto),
      verbose: Boolean(options.verbose),
      showDiff: Boolean(options.showDiff),
      model: options.model,
      maxDiffSize: options.maxDiffSize,
      stream: Boolean(options.stream),
      dryRun: Boolean(options.dryRun),
      noCommit: process.argv.includes('--no-commit'),
    });
  });

program
  .command('history')
  .description('View learned style profile and recent commit history')
  .option('--json', 'Output the style profile and recent commits as JSON')
  .action(async (options) => {
    await historyCommand({ json: Boolean(options.json) });
  });

program
  .command('batch')
  .description('Process multiple git repositories in batch mode')
  .argument('[directory]', 'Directory to scan for git repositories')
  .option('-r, --recursive', 'Recursively search subdirectories for git repos')
  .option('-v, --verbose', 'Print diagnostic information about the suggestion request')
  .option('-y, --yes', 'Automatically accept the first suggestion and commit without prompts')
  .option('--auto', 'Alias for --yes')
  .action(async (directory, options) => {
    const globalOpts = program.opts<{ yes?: boolean; auto?: boolean }>();
    await batchCommand({
      directory: directory || undefined,
      recursive: Boolean(options.recursive),
      verbose: Boolean(options.verbose),
      yes: Boolean(options.yes || options.auto || globalOpts.yes || globalOpts.auto),
    });
  });

program
  .command('completion')
  .description('Generate shell completion scripts for bash, zsh, and fish')
  .argument('[shell]', 'Target shell: bash, zsh, or fish')
  .action((shell?: string) => {
    completionCommand(shell);
  });

const hookCommand = new Command('hook')
  .description('Internal Git hook entry point')
  .argument('<hook-name>', 'Git hook name')
  .argument('[message-file]', 'Commit message file path provided by Git')
  .argument('[source]', 'Commit message source provided by Git')
  .argument('[sha]', 'Commit SHA provided by Git')
  .action(async (hookName: string, messageFile?: string, source?: string, sha?: string) => {
    if (hookName === 'prepare-commit-msg') {
      if (!messageFile) {
        throw new Error('prepare-commit-msg requires a message file path');
      }
      await runPrepareCommitMsgHook({ messageFile, source, sha });
      return;
    }

    if (hookName === 'post-commit') {
      await runPostCommitHook();
      return;
    }

    throw new Error(`Unsupported hook: ${hookName}`);
  });

program.addCommand(hookCommand, { hidden: true });

program.action(async () => {
  const opts = program.opts();
  await suggestCommand({ commit: true, autoCommit: Boolean(opts.yes || opts.auto) });
});

program.parse(process.argv);
