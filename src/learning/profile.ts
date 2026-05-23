import { getRecentCommits } from "../git/log.js";
import { analyzeCommits } from "./analyzer.js";
import { getConfig, setStyleProfile } from "../config/manager.js";
import { success, info } from "../utils/logger.js";
import type { StyleProfile } from "../config/types.js";

export async function learnStyle(): Promise<StyleProfile> {
  info("Analyzing your recent commits...");
  const entries = await getRecentCommits(50);
  if (entries.length === 0) {
    info("No commits found yet. Using default style profile.");
    const defaultProfile: StyleProfile = {
      dominantPrefix: "",
      prefixPct: 0,
      usesScope: false,
      scopePct: 0,
      avgSubjectLength: 50,
      tone: "imperative",
      usesBody: false,
      bodyPct: 0,
      examples: [],
      analyzedAt: new Date().toISOString(),
      totalCommits: 0,
    };
    setStyleProfile(defaultProfile);
    return defaultProfile;
  }

  const profile = analyzeCommits(entries);
  setStyleProfile(profile);
  success(`Analyzed ${profile.totalCommits} commits — style profile created.`);
  return profile;
}

export function getCurrentProfile(): StyleProfile | null {
  return getConfig().styleProfile;
}
