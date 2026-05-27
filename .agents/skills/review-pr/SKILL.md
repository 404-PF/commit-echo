---
name: review-pr
description: Use this skill when asked to review a GitHub pull request. Fetches the PR diff and files, analyzes changes against comprehensive criteria, and provides structured, actionable feedback.
---

# Review Pull Request

Use this skill when the user asks to review a pull request.

## Workflow

1. **Identify the PR** — Determine the PR number or branch to review
2. **Fetch PR details** — Gather comprehensive information:
   ```bash
   # Get PR metadata
   gh pr view <number> --json title,body,author,baseRefName,headRefName,additions,deletions,files,labels,assignees,reviewRequests,state,createdAt,closedAt,mergedAt,isDraft

   # Get the full diff
   gh pr diff <number>

   # Get the list of changed files with status
   gh pr view <number> --json files --jq '.files[] | "\(.path) (\(.status), +\(.additions)/-\(.deletions))"'
   ```
3. **Examine changes** — For each changed file, analyze the diff thoroughly
4. **Check project conventions** — Review AGENTS.md, CONTRIBUTING.md, and existing source files to understand the project's coding style and conventions
5. **Provide structured feedback** covering all sections below
6. **Summarize** with a clear verdict

## Review Checklist

Evaluate every PR against these criteria, grouped by category. Only report issues that actually apply — omit categories where the PR is clean.

### Overview
- **Purpose**: Does the PR title and description clearly explain what and why?
- **Scope**: Is the change focused (one feature/fix per PR)?
- **Size**: Is the PR a manageable size? If >500 lines, should it be split?

### Correctness & Logic
- **Edge cases**: Are edge cases (empty state, null/undefined, boundary values) handled?
- **Error handling**: Are errors caught and handled gracefully? Are appropriate error messages shown?
- **Race conditions**: Could async operations cause race conditions?
- **State management**: Are state changes predictable and consistent?
- **Validation**: Are inputs validated at boundaries (API, user input, file reads)?

### Code Quality & Maintainability
- **Readability**: Is the code easy to follow? Are variable/function names descriptive?
- **Duplication**: Is there repeated code that could be extracted?
- **Complexity**: Are functions/methods too long or doing too much (single responsibility)?
- **Dead code**: Is there commented-out code, unused imports, or unreachable branches?
- **Comments**: Are complex sections explained? Avoid obvious comments.
- **Project conventions**: Does the code follow the patterns found in existing files (naming, file structure, module pattern)?

### Security
- **Injections**: Could user input or file content lead to command injection, XSS, or SQL injection?
- **Secrets**: Are any API keys, tokens, or credentials exposed in the diff?
- **Dependencies**: Are new dependencies introduced? If so, are they necessary and reputable?
- **Permissions**: Are file permissions, network access, or data access properly restricted?
- **Validation**: Are values from external sources (env vars, config files, API responses) validated before use?

### Testing
- **Test coverage**: Are new features or fixes accompanied by tests?
- **Edge cases**: Do tests cover edge cases (not just the happy path)?
- **Existing tests**: Do existing tests still pass? Are any tests modified or removed appropriately?
- **Manual testing**: If automated tests aren't possible, has manual testing been described?

### Performance
- **Expensive operations**: Are there N+1 queries, large loops, or repeated computations?
- **Resource leaks**: Are file handles, network connections, or timers properly closed/cleaned up?
- **Caching**: Could caching improve repeated operations?
- **Bundle size**: For frontend changes, is the bundle size impact considered?

### Breaking Changes & Compatibility
- **API changes**: Are existing APIs modified or removed? Is there a migration path?
- **Dependency updates**: Do dependency version bumps introduce breaking changes?
- **Configuration**: Do config format changes maintain backward compatibility?
- **Database/data format**: Are data format migrations handled?

### Documentation
- **Inline docs**: Are complex algorithms or non-obvious patterns documented?
- **README**: Do user-facing changes require README updates?
- **CHANGELOG**: Should the change be noted in the changelog?
- **API docs**: Are public API changes reflected in documentation?

### File-Type Specific Checks

| File Type | Additional Checks |
|---|---|
| TypeScript/JavaScript | Type safety, `any` usage, proper generics, async/await handling |
| Python | PEP 8, type hints, virtual environment updates |
| CSS/SCSS | Specificity, naming convention (BEM, etc.), responsiveness |
| HTML/JSX | Accessibility (ARIA labels, keyboard nav, semantic HTML) |
| JSON/YAML | Valid syntax, proper nesting, no trailing commas |
| Dockerfile | Layer caching, image size, security scan |
| Markdown | Proper heading hierarchy, broken links |
| Shell scripts | Error handling (`set -e`), quoting, portability |
| Configuration | Correct environment variables, proper defaults |

## Verdicts

After completing the review, provide one of:

- **Approve** — No blocking issues; the PR is ready to merge
- **Request changes** — Blocking issues found (bugs, security, incorrectness) that must be fixed before merge
- **Comment** — Suggestions or minor issues that don't block merge but should be addressed

Include a brief rationale for the verdict.

## Notes

- Be constructive and specific in feedback — suggest solutions, not just problems
- Review against the project's coding style and conventions found in AGENTS.md, CONTRIBUTING.md, and source files
- Prioritize issues: **blocking** (correctness, security) > **important** (maintainability, performance) > **nitpick** (style, preferences)
- If the PR is very large (>1000 lines), focus on the most critical files and call out the size concern
- For draft PRs, provide early feedback but note that it's a work-in-progress
- When reviewing dependencies, check for known vulnerabilities via `npm audit` or equivalent
