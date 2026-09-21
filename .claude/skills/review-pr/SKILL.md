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

- If the user provided a reference like `owner/repo#123`, parse it into a repository (`owner/repo`) and pull request number.
- Otherwise, check for an active branch or recent PR in the workspace.
- Use the GitHub integration configured for the environment to find the PR when available; do not assume a connector-specific MCP tool name.
- When no GitHub integration is available and the reference was left blank, derive the current PR's repository and number before Step 2 with `repo="$(gh repo view --json nameWithOwner -q .nameWithOwner)"` and `number="$(gh pr view --json number -q .number)`.
- When no GitHub integration is available, use the `gh` CLI fallback described below.

### 2. Gather PR Details

Fetch the PR metadata, changed-file list, unified diff, and file contents before reviewing code:

- Use the configured GitHub integration when available to get the PR metadata, changed-file list, unified diff, and head revision.
- Otherwise, use the `gh` CLI commands in Step 5: `gh pr view "$number" -R "$repo"`, `gh pr diff "$number" -R "$repo"`, and the GitHub API fallback for file contents.
- Note the base and head branches and head revision to understand the diff scope.

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

If a configured GitHub integration is available, use it to submit the review with the requested event (`APPROVE`, `REQUEST_CHANGES`, or `COMMENT`). Otherwise use the `gh` CLI fallback below.

If GitHub MCP tools are unavailable, use `gh` CLI. When the user supplied a reference, parse `owner/repo#123` into `repo="$owner/$repo_name"` and `number="123"`. When the PR was detected from the workspace instead, derive `repo="$(gh repo view --json nameWithOwner -q .nameWithOwner)"` and `number="$(gh pr view --json number -q .number)"`. Then run `gh pr view "$number" -R "$repo" --json title,body,state,labels,baseRefName,headRefName,headRefOid,files` for PR metadata and the changed-file list.
- Use `gh pr diff "$number" -R "$repo"` for the unified diff.
- Extract the head revision with `head_sha="$(gh pr view "$number" -R "$repo" --json headRefOid -q .headRefOid)"` before fetching changed files.
- For each changed file with status other than `removed`, URL-encode each path segment before interpolation (spaces, `#`, `?`, and `%`). For example, set `encoded_path="$(python3 -c 'import sys; from urllib.parse import quote; print("/".join(quote(part, safe="") for part in sys.argv[1].split("/")))' "$path")"` and fetch it at the PR head with `gh api "repos/$repo/contents/$encoded_path?ref=$head_sha" -H "Accept: application/vnd.github.raw+json"`. A removed path is already represented by the diff and should be skipped. For a blob that exceeds the contents API size cap, use the Git Data blobs API with its blob SHA instead.
- For review submission, write the review body to a temporary file and use `gh pr review "$number" -R "$repo" --approve --body-file "$review_file"`, `--request-changes`, or `--comment` as appropriate. Never interpolate review text into shell command source.
