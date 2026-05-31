#!/usr/bin/env node

import { Command } from 'commander';
import pc from 'picocolors';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initCommand } from './commands/init.js';
import { suggestCommand } from './commands/suggest.js';
import { historyCommand } from './commands/history.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
let pkg: { version?: string; description?: string };
try {
  pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
} catch {
  pkg = { version: '0.1.0', description: '' };
}

const program = new Command();

program
  .name('commit-echo')
  .version(pkg.version ?? '0.1.0')
  .description(pkg.description ?? 'LLM-powered Git commit message assistant')
  .addHelpText(
    'after',
    `
${pc.dim('Examples:')}
  ${pc.cyan('commit-echo')}           Suggest and commit staged changes
  ${pc.cyan('commit-echo init')}      Run interactive setup wizard
  ${pc.cyan('commit-echo history')}   View learned style profile and history
`
  );

program
  .command('init')
  .description('Run interactive setup wizard to configure provider and model')
  .action(initCommand);

program
  .command('suggest')
  .description('Generate commit suggestions without committing')
  .option('--no-commit', 'Skip the commit step, only show suggestions')
  .option('-n, --dry-run', 'Show the LLM input without generating suggestions')
  .action(async (options) => {
    await suggestCommand({ commit: options.commit, autoCommit: false, dryRun: options.dryRun });
  });

program
  .command('history')
  .description('View learned style profile and recent commit history')
  .action(historyCommand);

program.action(async () => {
  await suggestCommand({ commit: true, autoCommit: false });
});

program.parse(process.argv);
