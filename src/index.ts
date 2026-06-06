#!/usr/bin/env node

import { Command } from 'commander';
import pc from 'picocolors';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initCommand } from './commands/init.js';
import { suggestCommand } from './commands/suggest.js';
import { historyCommand } from './commands/history.js';
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
  ${pc.cyan('commit-echo suggest')}    Generate suggestions without committing
  ${pc.cyan('commit-echo suggest --yes')} Auto-select first suggestion (no commit)
  ${pc.cyan('commit-echo history')}   View learned style profile and history

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

program
  .command('suggest')
  .description('Generate commit suggestions (use --commit to create a commit)')
  .option('--commit', 'Commit the selected suggestion', false)
  .option('-y, --yes', 'Automatically select the first suggestion and skip prompts')
  .option('-v, --verbose', 'Print diagnostic information about the suggestion request')
  .option('-m, --model <model>', 'Override the configured LLM model for this invocation')
  .option('--stream', 'Stream suggestions as they are generated (progressive output)')
  .option('--auto', 'Alias for --yes')
  .action(async (options) => {
    const globalOpts = program.opts<{ yes?: boolean; auto?: boolean }>();
    await suggestCommand({
      commit: options.commit,
      autoCommit: Boolean(
        options.yes || options.auto || globalOpts.yes || globalOpts.auto,
      ),
      verbose: Boolean(options.verbose),
      model: options.model,
      stream: Boolean(options.stream),
    });
  });

program.command('history').description('View learned style profile and recent commit history').action(historyCommand);

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
