import type { GenerateContext } from "../providers/types.js";

export function buildSystemPrompt(context: GenerateContext): string {
  const { styleProfile, conventionalCommits, maxSubjectLength } = context;
  const lines: string[] = [
    "You are a Git commit message generator. Your task is to write a clear, concise commit message for the given diff.",
    "",
    "RULES:",
    `- Subject line must be ${maxSubjectLength} characters or fewer`,
    "- Use imperative mood in the subject line (e.g., 'Add feature' not 'Added feature')",
    "- Do not wrap the subject line",
    "- If a body is needed, separate it from the subject with a blank line",
    "- Keep body lines wrapped at 72 characters",
    "- Respond with ONLY the commit message. No explanations, no markdown, no backticks.",
  ];

  if (conventionalCommits) {
    lines.push("- Use conventional commits format: <type>(<scope>): <description>");
    lines.push("- Valid types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert");
  }

  if (styleProfile && styleProfile.totalCommits > 0) {
    lines.push("", "The user's personal commit style (learned from their git history):");
    if (styleProfile.dominantPrefix) {
      lines.push(`- Preferred prefix: ${styleProfile.dominantPrefix} (used ${styleProfile.prefixPct}% of commits)`);
    }
    if (styleProfile.usesScope) {
      lines.push(`- Uses scopes (${styleProfile.scopePct}% of commits)`);
    }
    if (styleProfile.tone !== "mixed") {
      lines.push(`- Tone: ${styleProfile.tone}`);
    }
    if (styleProfile.usesBody) {
      lines.push(`- Includes body text (${styleProfile.bodyPct}% of commits)`);
    }
    lines.push(`- Average subject length: ${styleProfile.avgSubjectLength} chars`);
    lines.push("- Example subjects from their history:");
    for (const ex of styleProfile.examples) {
      lines.push(`  • ${ex}`);
    }
  }

  return lines.join("\n");
}

export function buildUserPrompt(context: GenerateContext): string {
  const { diff, diffStat } = context;
  const lines: string[] = [];

  if (diffStat) {
    lines.push(`Diff stats:\n${diffStat}`);
  }

  lines.push("");
  lines.push("```diff");
  lines.push(diff);
  lines.push("```");

  return lines.join("\n");
}
