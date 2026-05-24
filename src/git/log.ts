import { getGit } from "./client.js";

export interface CommitEntry {
  hash: string;
  authorName: string;
  authorEmail: string;
  subject: string;
  body: string;
  full: string;
}

async function getCurrentAuthorFilters(): Promise<{ name?: string; email?: string }> {
  const git = getGit();
  const [name, email] = await Promise.all([
    git.raw(["config", "--get", "user.name"]).then((value) => value.trim()).catch(() => ""),
    git.raw(["config", "--get", "user.email"]).then((value) => value.trim()).catch(() => ""),
  ]);

  const filters: { name?: string; email?: string } = {};
  if (name) filters.name = name;
  if (email) filters.email = email;
  return filters;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function getRecentCommits(count = 50): Promise<CommitEntry[]> {
  const git = getGit();
  const filters = await getCurrentAuthorFilters();
  const args = [
    "log",
    `--max-count=${count}`,
    "--pretty=format:%H%x1f%aN%x1f%aE%x1f%B%x1e",
  ];

  if (filters.name || filters.email) {
    const patterns = [filters.name, filters.email].filter(Boolean).map(escapeRegExp);
    if (patterns.length > 0) {
      args.push(`--author=${patterns.join("|")}`);
    }
  }

  const output = await git.raw(args);
  if (!output.trim()) return [];

  return output
    .split("\x1e")
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash = "", authorName = "", authorEmail = "", message = ""] = record.split("\x1f");
      const [subject = "", ...bodyParts] = message.split("\n");
      return {
        hash,
        authorName,
        authorEmail,
        subject,
        body: bodyParts.filter((line: string) => line.trim()).join("\n"),
        full: message,
      };
    });
}
