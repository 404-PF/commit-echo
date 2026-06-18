import { intro, outro } from '@clack/prompts';
import pc from 'picocolors';
import { loadConfig, configExists } from '../config/store.js';
import { buildProfile, formatProfile, loadEntries, countEntries } from '../history/store.js';
import type { CommitEntry, StyleProfile } from '../types.js';

type HistoryCommandOptions = {
  json?: boolean;
};

type HistoryJsonOutput = {
  profile: StyleProfile | null;
  recentCommits: CommitEntry[];
  totalCommits: number;
};

/** Build the script-friendly payload used by `commit-echo history --json`. */
async function getHistoryJsonOutput(): Promise<HistoryJsonOutput> {
  if (!configExists()) {
    return { profile: null, recentCommits: [], totalCommits: 0 };
  }

  const config = await loadConfig();
  const total = await countEntries();

  if (total === 0) {
    return { profile: null, recentCommits: [], totalCommits: 0 };
  }

  const profile = await buildProfile(config.historySize);
  const recentCommits = (await loadEntries(5)).reverse();

  return { profile, recentCommits, totalCommits: total };
}

/** Render commit history either as human CLI output or machine-readable JSON. */
export async function historyCommand(options: HistoryCommandOptions = {}): Promise<void> {
  if (options.json) {
    console.log(JSON.stringify(await getHistoryJsonOutput(), null, 2));
    return;
  }

  intro(pc.bold(pc.cyan('commit-echo history')));

  if (!configExists()) {
    outro(pc.yellow('No configuration found. Run `commit-echo init` first.'));
    return;
  }

  const config = await loadConfig();
  const total = await countEntries();

  if (total === 0) {
    outro(pc.yellow('No commit history yet. Commit messages will be saved after you accept suggestions.'));
    return;
  }

  const profile = await buildProfile(config.historySize);

  console.log(pc.bold('\n📊  Style Profile\n'));
  console.log(pc.dim(formatProfile(profile)));
  console.log();

  const recent = await loadEntries(5);

  if (recent.length > 0) {
    console.log(pc.bold('📝  Recent Commits\n'));
    for (const entry of recent.reverse()) {
      const date = new Date(entry.timestamp).toLocaleDateString();
      const firstLine = entry.message.split('\n')[0] ?? '';
      console.log(`  ${pc.dim(date)} ${firstLine}`);
    }
    console.log();
  }

  outro(`Total commits tracked: ${pc.bold(String(total))}`);
}
