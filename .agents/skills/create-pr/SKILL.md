---
name: create-pr
description: Use this skill when asked to create a GitHub pull request. Provides a structured workflow for gathering PR details, building a description from templates and commit logs, and creating the PR via the gh CLI.
---

# Create Pull Request

Use this skill when the user asks to create a pull request.

## Workflow

1. **Identify branches** — Determine the source (head) and target (base) branches:
   - Default head: current branch (`git branch --show-current`)
   - Default base: repo's default branch (`gh repo view --json defaultBranch --jq .defaultBranch`)
   - Confirm with the user if they differ from defaults

2. **Check for PR template** — Look for template files to pre-fill the body:
   - `.github/PULL_REQUEST_TEMPLATE.md` (single template)
   - `.github/PULL_REQUEST_TEMPLATE/` (multiple templates — list and ask which to use)
   - If found, load the template as the initial body and pre-fill any checklist items

3. **Gather PR metadata** — Ask the user about:
   - **Title**: Concise summary of changes (infer from branch name and commits if not provided)
   - **Body**: Description of changes. Use the following strategy if body is not explicitly provided:
     a. Load PR template (if exists) as base
     b. Run `git log <base>..<head> --oneline --no-decorate` to collect commits
     c. Run `git log <base>..<head> --format="%s%n%b---"` to get full commit messages including bodies
     d. Compose a summary from the commit log, filling in the template
   - **Labels**: Suggest labels based on conventional commit prefixes (feat → enhancement, fix → bug, etc.)
   - **Reviewers**: Ask if specific reviewers should be requested
   - **Assignees**: Ask if the PR should be assigned to someone
   - **Linked issues**: Detect references like "Closes #N", "Fixes #N" in branch name or recent commits
   - **Draft**: Ask if this should be a draft PR (not ready for review)

4. **Confirm details** — Display a summary (base, head, title, body preview, labels, reviewers, assignees, linked issues, draft status) and ask the user to confirm before proceeding.

5. **Pre-submit checks** — Optionally verify:
   - The project builds (e.g., `npm run build`)
   - Tests pass (e.g., `npm test`)
   - No uncommitted changes (`git status --porcelain`)
   - The branch is up to date with base (`git merge-base --is-ancestor <base> <head>`)

6. **Create the PR** — Use `gh pr create` with all gathered information and return the PR URL.

## Commands

```bash
# Get current branch name
git branch --show-current

# Get repo's default branch
gh repo view --json defaultBranch --jq .defaultBranch

# List PR templates
find .github/PULL_REQUEST_TEMPLATE -name '*.md' 2>/dev/null
test -f .github/PULL_REQUEST_TEMPLATE.md && echo "found"

# Read a specific PR template
cat .github/PULL_REQUEST_TEMPLATE/<template-file>

# Get commit log between base and head (condensed)
git log <base>..<head> --oneline --no-decorate

# Get commit log with full messages (for body composition)
git log <base>..<head> --format="## %s%n%n%b%n---%n"

# Check if branch is up to date with base
git merge-base --is-ancestor <base> <head> && echo "up-to-date" || echo "behind"

# Create the PR
gh pr create \
  --title "<title>" \
  --body "<body>" \
  --base "<base>" \
  --head "<head>" \
  --label "<labels>" \
  --reviewer "<reviewers>" \
  --assignee "<assignee>" \
  --project "<project>" \
  --draft

# Create PR with auto-fill (useful for quick PRs)
gh pr create --fill --base "<base>" --head "<head>"
```

## Notes

- If no base is specified, use the repo's default branch
- If no head is specified, use the current branch
- The `--fill` flag auto-populates title and body from commits (useful for conventional commits)
- Pass `--draft` for draft PRs (work in progress, not ready for review)
- Return the PR URL after creation (the `gh pr create` output includes the URL)
- When composing the body, structure it with: **Summary** of changes, **Motivation** (why), **Testing** (how verified), and **Checklist** of completed items
- Link related issues using GitHub keywords: `Closes #N`, `Fixes #N`, `Resolves #N`
- If the repo has a `.github/CODEOWNERS` file, suggest relevant reviewers from it
- Use conventional commit prefixes (feat, fix, chore, etc.) to automatically suggest labels
