---
name: scan-issues
description: 'Deeply scan and analyze issues in the codebase, then open GitHub issues to submit them. USE FOR: finding code smells, bugs, performance problems, security vulnerabilities, dead code, missing error handling, or other potential issues. Triggers: scan issues, find bugs, code review, detect problems, audit codebase, check for issues.'
argument-hint: '[optional: focus area like security, performance, or all]'
user-invocable: true
---

# Scan Issues

## When to Use

- Find potential bugs, code smells, or logic errors in the codebase
- Detect performance bottlenecks or inefficient patterns
- Identify security vulnerabilities or unsafe code
- Locate missing error handling, edge cases, or null safety issues
- Find dead code, unused imports, or deprecated patterns
- Audit codebase quality before a release or PR

## Procedure

### 1. Understand the Codebase

- Read `package.json`, `tsconfig.json`, or equivalent project config to understand the tech stack
- Identify the main source directories and entry points
- Note any existing linting, testing, or CI configuration

### 2. Define Scan Scope

Determine what to scan based on the user's request or codebase context:

| Focus Area | What to Look For |
|-----------|------------------|
| **security** | Hardcoded secrets, SQL injection, XSS, insecure dependencies, unsafe eval |
| **performance** | N+1 queries, unnecessary re-renders, memory leaks, large bundle imports |
| **reliability** | Missing null checks, unhandled promises, race conditions, uncaught exceptions |
| **maintainability** | Dead code, duplicated logic, overly complex functions, missing types |
| **all** | Comprehensive scan across all categories above |

### 3. Scan the Codebase

Work through the source files systematically. For each file:

1. **Read** the file content
2. **Analyze** for issues in the target focus area
3. **Classify** each finding by severity and category
4. **Document** the issue with file path, line number, description, and suggested fix

Use a subagent for large codebases to parallelize scanning across directories.

### 4. Deduplicate and Prioritize

- Merge duplicate or overlapping findings
- Rank issues by severity:
  - **Critical**: Security vulnerabilities, data loss risks, crashes
  - **High**: Bugs that affect functionality, performance regressions
  - **Medium**: Code smells, maintainability concerns, missing best practices
  - **Low**: Minor style issues, suggestions, nitpicks
- Group related issues that can be addressed together

### 5. Create GitHub Issues

For each prioritized issue (or group of related issues), create a GitHub issue using the GitHub MCP tools:

1. **Title**: Use format `[Category] Short description` (e.g., `[Security] Hardcoded API key in config.ts`)
2. **Labels**: Apply appropriate labels based on severity and category
3. **Body**: Include:
   - **Description**: What the issue is and why it matters
   - **Location**: Exact file path and line number(s)
   - **Code snippet**: The problematic code
   - **Suggested fix**: How to resolve the issue
   - **Impact**: What could happen if left unaddressed

### 6. Summary Report

After all issues are created, provide the user with a summary:

```
## Scan Results

| Category | Critical | High | Medium | Low | Total |
|----------|----------|------|--------|-----|-------|
| Security | X | X | X | X | X |
| Performance | X | X | X | X | X |
| Reliability | X | X | X | X | X |
| Maintainability | X | X | X | X | X |
| **Total** | **X** | **X** | **X** | **X** | **X** |

Issues created: [list links to created issues]
```

## Guidelines

- **Be specific**: Every issue must reference an exact file and line number
- **Be actionable**: Include a suggested fix, not just a complaint
- **Avoid false positives**: Only report issues you are confident about
- **Respect project conventions**: Don't flag patterns the project intentionally uses
- **Don't overwhelm**: Group minor issues together into a single issue rather than creating many tiny ones
