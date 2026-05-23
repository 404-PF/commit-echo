import { simpleGit, type SimpleGit } from "simple-git";

let git: SimpleGit | null = null;

export function getGit(): SimpleGit {
  if (!git) git = simpleGit();
  return git;
}
