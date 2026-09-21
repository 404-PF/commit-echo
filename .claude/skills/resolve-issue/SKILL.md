---
name: resolve-issue
description: "**WORKFLOW SKILL** — Systematically resolve GitHub issues from assignment through PR creation. USE FOR: working on assigned issues; following structured debugging workflows; implementing feature requests; fixing bugs reported in issues; creating focused PRs linked to issues. DO NOT USE FOR: creating new issues (use create-issue); reviewing PRs (use review-pr); general coding tasks without an issue context."
user-invocable: true
argument-hint: '[issue-number]'
---

# Resolve Issue Workflow

## Overview

This skill provides a structured approach to resolving GitHub issues: from understanding the problem through implementation to creating a linked pull request.

## Core Workflow

### 1. Understand the Issue

- **Auto-fetch issue details**: Use `issue_read` to get the issue title, body, labels, assignees, and linked PRs
- **Analyze labels**: Identify issue type from labels (e.g., `bug`, `enhancement`, `feature`) to determine approach and branch naming
- **Clarify scope**: Identify what's requested vs. what's needed
- **Identify constraints**: Check for performance, compatibility, or design requirements
- **Review related discussions**: Use `issue_read` with `get_comments` to gather additional context or decisions

### 2. Plan the Solution

- **Break down into tasks**: Identify specific code changes needed
- **Assess complexity**: Determine if this is a simple fix or requires architectural changes
- **Consider edge cases**: Think about error handling and boundary conditions
- **Choose approach**: Decide between multiple possible solutions if applicable

### 3. Implement Changes

- **Create a branch**: Auto-detect naming convention from issue labels:
  - `bug` labels → `fix/<issue-number>-<short-description>`
  - `enhancement`/`feature` labels → `feat/<issue-number>-<short-description>`
  - Default → `fix/<issue-number>-<short-description>`
- **Make focused changes**: Keep changes minimal and related to the issue
- **Follow project conventions**: Use existing patterns, coding standards, and architecture
- **Write tests**: Add or update tests to cover the changes

### 4. Validate and Test

- **Run existing tests**: Ensure no regressions
- **Test new functionality**: Verify the fix or feature works as expected
- **Check edge cases**: Test boundary conditions and error scenarios
- **Review your changes**: Self-review for quality and completeness

### 5. Document and Reference

- **Update documentation**: If behavior changed, update relevant docs
- **Reference the issue**: Use `Closes #123` or `Fixes #123` in commit messages
- **Write clear commit messages**: Follow conventional commit standards

### 6. Create Pull Request

Suggest creating a PR when implementation is complete. If the user wants to proceed, reference the **create-pr** skill for best practices.

- **Confirm with user**: Ask if they want to create the PR now
- **Link to the issue**: Ensure the PR references the issue it resolves (e.g., "Closes #123")
- **Write descriptive PR title and description**: Explain what changed and why
- **Request review**: Assign appropriate reviewers
- **Respond to feedback**: Address review comments promptly

## Deep-Dive Sections

### Debugging Complex Issues

For issues requiring investigation:

1. **Reproduce the problem**: Create a minimal reproduction case
2. **Add debugging instrumentation**: Log relevant state and parameters
3. **Isolate the cause**: Use binary search or divide-and-conquer approaches
4. **Verify the fix**: Ensure the fix addresses root cause, not just symptoms

### Feature Implementation

For feature requests:

1. **Design the API**: Consider how users will interact with the feature
2. **Plan backward compatibility**: Ensure existing functionality isn't broken
3. **Consider performance**: Evaluate impact on performance and resource usage
4. **Write comprehensive tests**: Cover happy path and error scenarios

### Refactoring for Issues

When the issue reveals code quality problems:

1. **Separate refactoring from fixes**: Keep refactoring changes separate
2. **Ensure behavior preservation**: Refactoring shouldn't change functionality
3. **Update tests if needed**: Tests should still pass after refactoring

## Quality Checklist

Before submitting a PR, verify:

- [ ] Issue is clearly understood and scoped
- [ ] Solution addresses the root cause
- [ ] Changes are minimal and focused
- [ ] Tests cover new or changed functionality
- [ ] No regressions introduced
- [ ] Code follows project conventions
- [ ] Documentation updated if needed
- [ ] Commit messages are clear and reference the issue

## Example Prompts

- "Resolve issue #123 by implementing the requested feature"
- "Fix the bug described in issue #456"
- "Work on issue #789 following the resolve-issue workflow"
- "Help me understand and fix issue #101"

## Related Skills

- **create-issue**: For creating new issues
- **commit**: For writing proper commit messages
- **create-pr**: For creating pull requests
- **review-pr**: For reviewing pull requests