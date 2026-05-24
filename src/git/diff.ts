import { NoStagedChangesError } from "../utils/errors.js";
import { getGit } from "./client.js";

export interface DiffContext {
  diff: string;
  diffStat: string;
  branch: string;
  changedFiles: string[];
}

export async function getStagedDiff(): Promise<DiffContext> {
  const g = getGit();
  const status = await g.status();
  if (status.staged.length === 0) {
    throw new NoStagedChangesError();
  }

  const [diff, diffStat, branch] = await Promise.all([
    g.diff(["--cached"]),
    g.diff(["--cached", "--stat"]),
    g.branch(),
  ]);

  return {
    diff: diff || "(binary or empty diff)",
    diffStat: diffStat || "",
    branch: branch.current || "HEAD",
    changedFiles: status.staged,
  };
}

