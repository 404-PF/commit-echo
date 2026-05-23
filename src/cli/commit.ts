import * as p from "@clack/prompts";
import { runGenerate } from "./generate.js";
import { success, error, info } from "../utils/logger.js";
import { getGit } from "../git/client.js";

interface CommitOptions {
  provider?: string;
  model?: string;
}

export async function runCommit(opts: CommitOptions = {}): Promise<void> {
  const message = await runGenerate(opts);
  if (!message) return;

  const subjectLine = message.split("\n")[0];
  const confirm = await p.confirm({
    message: `Commit: ${subjectLine}`,
    initialValue: true,
  });

  if (p.isCancel(confirm) || !confirm) {
    info("Commit cancelled.");
    return;
  }

  try {
    const git = getGit();
    const status = await git.status();
    const result = await git.commit(message, status.staged);
    success(`Committed successfully: ${result.commit}`);
  } catch (err) {
    error(`Commit failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
