---
name: create-pr
description: 'Create a GitHub pull request from the current branch. Use when the user asks to create a PR, open a pull request, or submit a PR for review. Assumes branch is pushed. Auto-generates title and description from commit history.'
user-invocable: true
argument-hint: 'Optional: base branch name (defaults to main)'
---

# Create Pull Request

## When to Use
- User asks to "create a PR", "open a pull request", or "submit for review"
- User wants to submit changes for team review
- After completing work on a feature branch

## Prerequisites
- Current branch must have at least one commit ahead of the base branch
- Branch will be auto-pushed to remote if not already pushed

## Procedure

### 1. Determine Branch Context
- Identify the current branch name
- Identify the base branch (default: `main`, or use the argument if provided)
- Verify there are commits ahead of the base branch
- If branch has no upstream or has unpushed commits, push automatically (`git push -u origin <branch>`)

### 2. Analyze Commits
- Run `git log --oneline base..current` to get all commits on the feature branch
- Group commits by type (feat, fix, refactor, docs, test, chore, etc.)
- Identify the primary change/feature being introduced

### 3. Generate PR Metadata

**Title** (max 72 characters):
- Use the first line of the most significant commit, or synthesize from commit grouping
- Follow Conventional Commits format when commits use it: `type(scope): description`

**Description body** (Markdown):
```markdown
## Summary
[1-2 sentence description of what this PR accomplishes]

## Changes
- **feat**: [list of feature commits]
- **fix**: [list of bug fix commits]
- **refactor**: [list of refactors]
- [other categories as needed]

## Testing
[How to test these changes, if evident from commits or code]

## Related
[Closes #123, Fixes #456 if commit messages reference issues]
```

### 4. Ask User for Confirmation
Before creating the PR, present:
- The generated title
- The generated description
- Ask: **Draft or Ready for review?**

### 5. Create the Pull Request

Prefer **GitHub MCP tools** (`mcp_github_mcp_se_create_pull_request`) to create the PR. If MCP tools are unavailable or fail, fall back to **`gh` CLI** in the terminal:
```bash
gh pr create --base <base> --head <head> --title "<title>" --body "<body>"
```

Set the following:
- `title` → generated title
- `body` → generated description
- `head` → current branch
- `base` → target branch
- `draft` → based on user preference

### 6. Report Result
- Display the created PR URL
- Suggest next steps (e.g., request reviewers, add labels)

## Example Usage

User: "create a PR"
→ Skill detects current branch `feat/user-auth`, base `main`
→ Analyzes 5 commits, generates title and description
→ Presents to user for review
→ Creates PR when confirmed

User: "create a PR targeting develop"
→ Uses `develop` as the base branch instead of `main`

## Notes
- If commits are not conventional format, synthesize description from commit diffs
- For single-commit PRs, use the commit message directly
- Always verify remote tracking branch exists or offer to push
