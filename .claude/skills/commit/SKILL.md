---
name: commit
description: "**WORKFLOW SKILL** — Stage changes, write clear commit messages, and commit following best practices. USE FOR: committing code changes; writing conventional commit messages; staging files before commits; amending previous commits; creating atomic commits; generating commit messages from diffs. DO NOT USE FOR: pushing to remote (use git push); resolving merge conflicts; branching or rebasing."
user-invocable: true
---

# Commit Workflow

## Overview

This skill guides a structured commit workflow: analyze changes, stage appropriately, write a clear commit message, and commit.

## Workflow Steps

### 1. Analyze Changes

Review what has changed before committing:

- **Check status**: Understand which files are modified, added, or deleted
- **Review diffs**: Understand *what* and *why* each change was made
- **Group related changes**: Identify logical units of work that belong together

### 2. Stage Changes

Stage files intentionally — avoid `git add .` unless all changes are part of one commit:

- **Atomic commits**: Each commit should represent one logical change
- **Partial staging**: Use `git add -p` for interactive staging when a file contains multiple unrelated changes
- **Review before staging**: Confirm no debug code, secrets, or unrelated files are included

### 3. Write Commit Message

Follow this structure:

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Type** (pick one):
| Type | When to Use |
|------|-------------|
| `feat` | New feature or capability |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Formatting, missing semicolons, etc. (no logic change) |
| `refactor` | Code restructuring (no feature or fix) |
| `test` | Adding or updating tests |
| `chore` | Build, CI, tooling, dependencies |
| `perf` | Performance improvement |

**Subject line rules**:
- Use imperative mood: "add" not "added" or "adds"
- No period at the end
- Keep under 72 characters
- Capitalize the first letter

**Body** (when needed):
- Explain *what* and *why*, not *how*
- Wrap at 72 characters
- Separate from subject with a blank line

**Footer** (when applicable):
- Reference issues: `Closes #123`, `Fixes #456`
- Note breaking changes: `BREAKING CHANGE: <description>`

### 4. Commit

- Review the commit message one more time
- Commit with `git commit`
- Verify with `git log --oneline -1`

## Common Patterns

**Simple change**:
```
fix(auth): prevent token refresh race condition
```

**Feature with context**:
```
feat(api): add pagination to user list endpoint

Implement offset-based pagination with configurable page size.
Default limit is 20 items per page. Includes cursor-based
navigation for large datasets.

Closes #234
```

**Breaking change**:
```
refactor(config)!: rename environment variables for consistency

BREAKING CHANGE: DATABASE_URL is now DB_CONNECTION_STRING
```

## Quality Checklist

Before finalizing a commit, verify:

- [ ] Changes are staged intentionally (no unintended files)
- [ ] Commit type accurately describes the change
- [ ] Subject is imperative, concise, and under 72 chars
- [ ] Body explains *why* (if non-obvious)
- [ ] No secrets, credentials, or debug code included
- [ ] Commit represents a single logical change
