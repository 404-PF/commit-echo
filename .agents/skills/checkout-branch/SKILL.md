---
name: checkout-branch
description: 'Create and switch to a new branch. Accepts a branch name or GitHub issue number. Derives branch name from issue title when an issue number is given. USE FOR: starting new work, branching from an issue, creating feature/bugfix branches. DO NOT USE FOR: committing, pushing, or managing PRs.'
user-invocable: true
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
2. Go to Step 3

### 2b. Explicit Name Flow

1. Use the provided name exactly
2. Validate it is a valid Git branch name (no spaces, no `..`, no `~^:?*[\`, not `@{`, not `-`)
3. If invalid, suggest a sanitized version and ask the user to confirm
4. Go to Step 3

### 3. Create and Switch

Run the following steps:

```bash
# Fetch latest remote refs
git fetch origin

# Create branch from default branch (usually main or master)
# Determine the default branch first:
git remote show origin | grep "HEAD branch"
```

Then create and switch:

```bash
git checkout -b <branch-name> origin/<default-branch>
```

If the branch already exists locally, ask the user whether to:
- **Switch** to the existing branch (`git checkout <branch-name>`)
- **Reset** it to the latest origin (`git checkout -B <branch-name> origin/<default-branch>`)
- **Choose a different name**

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
