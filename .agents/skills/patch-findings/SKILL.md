---
name: patch-findings
description: 'Generate fix patches from pre-identified findings. Use when: generating code fixes from PR review comments, producing patches from scan results, translating described problems into code changes. DO NOT USE FOR: resolving GitHub issues (use resolve-issue); creating PRs (use create-pr); managing branches.'
argument-hint: 'describe the finding to patch'
---

# Patch Findings

Generate targeted fix patches from pre-identified findings. This skill handles the code-level fix generation — it does NOT manage issues, branches, or PRs.

## Scope

| This skill (patch-findings) | Use resolve-issue instead |
|---|---|
| Fix from a PR review comment | Fix from a GitHub issue |
| Fix from a scan/audit finding | Full issue-to-PR workflow |
| Fix from a described problem | Need issue tracking, branching, PR creation |

## When to Use

- A PR review comment identifies a problem that needs a code fix
- A code scan or audit has flagged specific issues
- The user describes a problem and wants a targeted patch

## Procedure

### 1. Understand the Finding

Clarify what needs fixing:
- Read the affected file(s) and surrounding code
- Identify the root cause
- Determine the minimal change needed
- Check for related code that may need the same fix

### 2. Generate the Patch

Make the minimal, focused change:
- Fix only what's needed — no drive-by refactors
- Follow existing project conventions and patterns
- Add or update tests if the project has test coverage

### 3. Validate

- Run linting and type checks
- Run relevant tests
- Review the diff for correctness and regressions

### 4. Present

Show the user:
- What was fixed and why
- The diff for review
- Any follow-up actions (branching, committing, PR creation are outside this skill)
