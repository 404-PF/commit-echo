import type { StyleProfile, ChatMessage, TruncationInfo, Config } from '../types.js';

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

/**
 * Variables available for substitution in custom prompt templates.
 */
export interface TemplateVars {
  diff: string;
  profile: string;
  branch: string;
}

/**
 * Substitute {{variables}} in a template string with the provided values.
 * Unknown variables are left as-is.
 */
export function substituteTemplateVars(template: string, vars: TemplateVars): string {
  return template
    .replace(/\{\{diff\}\}/g, vars.diff)
    .replace(/\{\{profile\}\}/g, vars.profile)
    .replace(/\{\{branch\}\}/g, vars.branch);
}

/**
 * Resolve the system prompt to use.
 *
 * If config provides a `systemPromptTemplate`, it is used with template
 * variables substituted. Otherwise the built-in prompt is returned.
 */
export function resolveSystemPrompt(
  profile: StyleProfile,
  vars: TemplateVars,
  config?: Config
): string {
  if (config?.systemPromptTemplate) {
    return substituteTemplateVars(config.systemPromptTemplate, vars);
  }
  return buildSystemPrompt(profile);
}

/**
 * Resolve the user prompt to use.
 *
 * If config provides a `userPromptTemplate`, it is used with template
 * variables substituted. Otherwise the built-in prompt is returned.
 */
export function resolveUserPrompt(
  vars: TemplateVars,
  config?: Config
): string {
  if (config?.userPromptTemplate) {
    return substituteTemplateVars(config.userPromptTemplate, vars);
  }
  return buildUserPrompt(vars.diff);
}

/**
 * Return a description of available template variables for documentation.
 */
export function getAvailableTemplateVars(): string {
  return [
    '{{diff}}     - The git diff text',
    '{{profile}}  - The learned style profile summary',
    '{{branch}}   - Current git branch name',
    '{{message}}  - (reserved) Previous commit message context',
  ].join('\n');
}

/**
 * Truncate a diff string to fit within `maxSize` characters.
 *
 * Preserves full file sections (diff --git headers + hunks) until the limit is
 * reached. For the first file that overflows, keeps its header lines (diff --git,
 * index, ---, +++) and first @@ hunk header if space allows. All subsequent
 * files are dropped and a `[...truncated N file(s)...]` marker is appended.
 */
export function truncateDiff(diff: string, maxSize: number): { diff: string; info: TruncationInfo } {
  if (diff.length <= maxSize) {
    return {
      diff,
      info: { wasTruncated: false, originalSize: diff.length, truncatedSize: diff.length, filesTruncated: 0 },
    };
  }

  // Split into per-file sections on "diff --git" boundaries
  const sections = diff.split(/\n(?=diff --git)/).filter((s) => s.trim().length > 0);
  const totalFiles = sections.length;

  const kept: string[] = [];
  let remaining = maxSize;
  let fullyKept = 0;
  let partialFile: string | null = null;

  for (const section of sections) {
    if (partialFile) break; // already past the limit

    if (section.length <= remaining) {
      kept.push(section);
      remaining -= section.length;
      fullyKept++;
    } else {
      // Partial: keep header lines of this file
      const lines = section.split('\n');
      const headerLines: string[] = [];

      for (const line of lines) {
        const isMeta =
          line.startsWith('diff --git') ||
          line.startsWith('index ') ||
          line.startsWith('--- ') ||
          line.startsWith('+++ ');

        const lineCost = line.length + 1; // +1 for trailing newline

        if (isMeta && lineCost <= remaining - 20) {
          headerLines.push(line);
          remaining -= lineCost;
        } else if (line.startsWith('@@') && lineCost <= remaining - 20) {
          headerLines.push(line);
          remaining -= lineCost;
          break; // stop after @@ hunk header
        } else {
          break;
        }
      }

      if (headerLines.length > 0) {
        partialFile = headerLines.join('\n');
        kept.push(partialFile);
      }
    }
  }

  const filesTruncated = totalFiles - fullyKept;
  const fileWord = filesTruncated === 1 ? 'file' : 'files';
  const marker = `\n[...truncated ${filesTruncated} ${fileWord}...]`;
  kept.push(marker);

  const result = kept.join('\n');

  return {
    diff: result,
    info: { wasTruncated: true, originalSize: diff.length, truncatedSize: result.length, filesTruncated },
  };
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
