import { simpleGit, type SimpleGit } from "simple-git";

let git: SimpleGit | null = null;
function getGit(): SimpleGit {
  if (!git) git = simpleGit();
  return git;
}

export interface CommitEntry {
  hash: string;
  subject: string;
  body: string;
  full: string;
}

export async function getRecentCommits(count = 50): Promise<CommitEntry[]> {
  const log = await getGit().log({ maxCount: count, format: { hash: "%H", message: "%B" } });
  return log.all.map((entry: { hash: string; message: string }) => {
    const [subject = "", ...bodyParts] = entry.message.split("\n");
    return {
      hash: entry.hash,
      subject,
      body: bodyParts.filter((l: string) => l.trim()).join("\n"),
      full: entry.message,
    };
  });
}
