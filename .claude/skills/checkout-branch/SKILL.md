---
name: checkout-branch
description: 'Create and switch to a new branch. Accepts a branch name or GitHub issue number. Derives branch name from issue title when an issue number is given. USE FOR: starting new work, branching from an issue, creating feature/bugfix branches. DO NOT USE FOR: committing, pushing, or managing PRs.'
user-invocable: true
disable-model-invocation: true
argument-hint: '<branch-name-or-issue-number>'
---

# Checkout Branch

Create a new Git branch and switch to it. Supports two input modes:

1. **Issue number** (e.g., `42`) — fetches the issue title and derives a branch name like `feature/42-fix-login-error`
2. **Branch name** (e.g., `feature/my-feature`) — uses the name as-is

## Procedure

### 1. Determine Input Type

- If the argument is a **pure number** → treat as an issue number, go to Step 2a
- Otherwise → treat as an explicit branch name, go to Step 2b

### 2a. Issue Number Flow

1. Fetch the issue from the current GitHub repository using the provided issue number
   - Extract the issue title
   - Derive a slug: lowercase the title, replace spaces with hyphens, strip special characters, truncate to 50 chars
   - Choose a prefix based on issue labels (if available):
     - `bug`, `bugfix`, `defect` → `bugfix/<number>-<slug>`
     - `enhancement`, `feature` → `feature/<number>-<slug>`
     - No matching label → `issue/<number>-<slug>`
   - Confirm the derived branch name with the user before proceeding
   - After confirmation, record the confirmed name so it can be reused in Step 3.
2. Go to Step 3

### 2b. Explicit Name Flow

1. Store the provided name as the confirmed `branch_name` value.
2. Validate it by running `git check-ref-format --branch "$branch_name"`; exit status 0 means valid, non-zero means invalid.
3. If invalid, suggest a sanitized version and ask the user to confirm.
4. After confirmation, carry the confirmed branch name explicitly into Step 3; do not rely on shell variables persisting across separate tool invocations.
5. Go to Step 3

### 3. Create and Switch

Resolve the GitHub remote before running the workflow:

1. Inspect configured remotes with `git remote -v`.
2. Select the GitHub remote to use; if none exists, stop and ask for a GitHub remote. If multiple GitHub remotes exist, ask the user which one to use.
3. After the branch name is confirmed and the remote is selected, run the following block as one shell invocation, passing the confirmed branch name and selected remote as positional arguments rather than interpolating either value into shell source. `$1` is the confirmed branch name and `$2` is the selected GitHub remote; do not rely on shell variables persisting across tool invocations.

```bash
branch_name="$1"
github_remote="$2"
git remote get-url "$github_remote"
git fetch "$github_remote"
if ! git remote set-head "$github_remote" --auto >/dev/null; then
  echo "Could not determine a unique default branch for $github_remote." >&2
  exit 1
fi
default_ref="$(git symbolic-ref --quiet "refs/remotes/$github_remote/HEAD" || true)"
if [ -z "$default_ref" ]; then
  echo "No default branch is available for $github_remote." >&2
  exit 1
fi
default_branch="${default_ref#refs/remotes/$github_remote/}"
git checkout -b "$branch_name" "$github_remote/$default_branch"
```

If the branch already exists locally, ask the user whether to run one of these commands with the confirmed branch name as a quoted argument:
- **Switch**: `git checkout "<confirmed-branch-name>"`
- **Reset** it to the latest remote: `git checkout -B "<confirmed-branch-name>" "$github_remote/$default_branch"`
- **Choose a different name**

Do not interpolate a branch name directly into shell command text.

### 4. Verify

After switching:

- Confirm the current branch with `git branch --show-current`
- Show a short summary: branch name, base branch, and tracking status

## Example Interactions

| User says | Action |
|-----------|--------|
| `/checkout-branch 42` | Fetch issue #42, derive `feature/42-fix-login`, create & switch |
| `/checkout-branch feature/auth-refactor` | Create & switch to `feature/auth-refactor` |
| `/checkout-branch bugfix/15-memory-leak` | Create & switch to `bugfix/15-memory-leak` |

## Edge Cases

- **Branch already exists locally**: Offer switch, reset, or rename.
- **Issue not found**: Report the error and ask the user to provide a branch name manually.
- **Detached HEAD state**: Warn the user and suggest creating a new branch from their current commit.
- **Dirty working tree**: Warn the user that uncommitted changes will be carried over; suggest stashing first if they prefer.
