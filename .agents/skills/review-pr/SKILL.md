---
name: review-pr
description: 'Review a pull request for quality, issues, and improvements. Use when the user asks to review a PR, check a pull request, do a code review, or assess PR quality. Triggers: review pr, pull request review, code review, check pr.'
user-invocable: true
argument-hint: '<owner/repo#number> or leave blank to detect from context'
---

# Pull Request Review

Comprehensive PR review that summarizes changes, identifies potential issues, and suggests improvements.

## Procedure

### 1. Identify the PR

- If the user provided a reference like `owner/repo#123`, parse it.
- Otherwise, check for an active branch or recent PR in the workspace.
- Use `mcp_github_mcp_se_search_pull_requests` to find the PR if needed.

### 2. Gather PR Details

Fetch the PR metadata and content:
- Use `mcp_github_mcp_se_search_pull_requests` with the PR query to get title, description, author, state, and labels.
- Use `mcp_github_mcp_se_list_branches` if branch info is needed.
- Note the base and head branches to understand the diff scope.

### 3. Analyze Changes

Examine the PR systematically:

**a. Understand the intent**
- Read the PR title and description for what problem it solves.
- Check linked issues if any.

**b. Review changed files**
- Look at the diff for each changed file.
- Focus on logic changes, not just formatting.

**c. Evaluate quality across these dimensions:**

| Dimension | What to check |
|-----------|---------------|
| **Correctness** | Logic errors, off-by-one, null handling, race conditions |
| **Security** | Injection risks, secret leaks, auth bypasses, input validation |
| **Performance** | N+1 queries, unnecessary re-renders, memory leaks, missing indexes |
| **Maintainability** | Naming, duplication, complexity, missing documentation |
| **Testing** | Adequate coverage, edge cases, test quality |
| **API Design** | Consistency, backward compatibility, clear interfaces |

### 4. Compile the Review

Present findings in this structure:

#### Summary
One paragraph explaining what the PR does and whether it achieves its goal.

#### Strengths
What the PR does well (call out good patterns, thorough tests, clear docs).

#### Issues Found
Categorized by severity:

**🔴 Critical** — Must be fixed before merge (bugs, security, data loss)
**🟡 Suggestions** — Should be considered (performance, maintainability)
**🟢 Nitpicks** — Optional improvements (style, naming)

For each issue:
- **File and location** — Where the issue is
- **Description** — What the problem is
- **Suggestion** — How to fix it (with code example if helpful)

#### Testing Assessment
Whether the test coverage is adequate and what additional tests might be needed.

#### Verdict
One of:
- **Approve** — Good to merge
- **Approve with suggestions** — Mergeable but consider the suggestions
- **Request changes** — Critical issues must be resolved first

### 5. Optional: Submit the Review

If the user wants, use `mcp_github_mcp_se_pull_request_review_write` to submit the review directly on GitHub with the appropriate event (`APPROVE`, `REQUEST_CHANGES`, or `COMMENT`).
