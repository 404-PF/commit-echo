import type { StyleProfile, ChatMessage } from '../types.js';

function buildStyleGuidance(profile: StyleProfile): string {
  if (profile.totalCommits === 0) {
    return 'No previous commit history available. Use a clear, concise style.';
  }

  const parts: string[] = [];

  parts.push(`- Keep the first line around ${profile.avgLength} characters.`);

  if (profile.imperativeRate >= 0.5) {
    parts.push('- Use imperative mood (e.g., "Add feature", not "Added feature").');
  }

  if (profile.sentenceCaseRate >= 0.5) {
    parts.push('- Start with a capital letter.');
  }

  if (profile.commonPrefixes.length > 0) {
    const topPrefix = profile.commonPrefixes[0];
    const rate = Math.round((profile.prefixRates[topPrefix] ?? 0) * 100);
    if (rate >= 30) {
      parts.push(`- The project commonly uses "${topPrefix}:" prefix. Match this convention.`);
    }
    if (profile.commonPrefixes.length > 1) {
      const prefixes = profile.commonPrefixes.slice(0, 3).join(', ');
      parts.push(`- Commonly used prefixes in this project: ${prefixes}.`);
    }
  }

  if (profile.usesScopeRate > 0.3) {
    parts.push('- Include a scope in parentheses when relevant (e.g., "feat(api): ...").');
  }

  if (profile.usesBodyRate > 0.3) {
    parts.push('- Include a body paragraph explaining motivation and context when the change is non-trivial.');
  } else if (profile.usesBodyRate < 0.1) {
    parts.push('- Keep commits to a single line. No body paragraph needed.');
  }

  return parts.join('\n');
}

export function buildSystemPrompt(profile: StyleProfile): string {
  return `You are an expert Git commit message assistant. Your purpose is to generate clear, concise, and informative commit messages that follow the conventions of the project.

Generate exactly 3 commit message options. Each option should:
1. Be a single line (50-72 characters preferred)
2. Use conventional commits format when appropriate
3. Clearly describe WHAT and WHY (not how)
4. Be distinct from each other in tone or focus

Style guidance from previous commits:
${buildStyleGuidance(profile)}

Format your response as a numbered list (1., 2., 3.) with each commit message on a separate line. Optionally, add a short body paragraph below a message if the change warrants explanation, separated by a blank line.`;
}

export function buildUserPrompt(diff: string): string {
  return `Generate 3 commit message suggestions for the following diff:\n\`\`\`diff\n${diff}\n\`\`\`\n\nReturn exactly 3 options as a numbered list.`;
}

export function parseSuggestions(content: string, count: number = 3): { message: string; body?: string }[] {
  const suggestions: { message: string; body?: string }[] = [];
  const lines = content.split('\n');
  let current: { message: string; bodyLines: string[] } | null = null;

  for (const line of lines) {
    const listItemMatch = line.match(/^(?:\d+[.)]|\s*[-*])\s+(.*\S.*)/);
    if (listItemMatch) {
      if (current) {
        suggestions.push({
          message: current.message,
          body: current.bodyLines.length > 0 ? current.bodyLines.join('\n').trim() : undefined,
        });
      }
      current = { message: listItemMatch[1]!.trim(), bodyLines: [] };
    } else if (current) {
      const trimmed = line.trim();
      if (trimmed) {
        current.bodyLines.push(trimmed);
      }
    }
  }

  if (current) {
    suggestions.push({
      message: current.message,
      body: current.bodyLines.length > 0 ? current.bodyLines.join('\n').trim() : undefined,
    });
  }

  return suggestions.slice(0, count);
}
