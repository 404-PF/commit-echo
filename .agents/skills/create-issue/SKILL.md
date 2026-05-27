---
name: create-issue
description: Use this skill when asked to create a GitHub issue. Provides a structured workflow for gathering issue details, template support, duplicate detection, and creating issues via the gh CLI.
---

# Create Issue

Use this skill when the user asks to create a GitHub issue.

## Workflow

1. **Determine issue details** — If not already provided, diagnose the codebase to infer a sensible title, body (description), labels, and issue type (Bug, Feature, Task). Propose the generated values to the user.
2. **Check for issue templates** — Look for template files in the repo:
   - `.github/ISSUE_TEMPLATE/` (multiple templates)
   - `.github/ISSUE_TEMPLATE.md` (single template)
   - If templates exist, list them and ask the user which to use (or "none"). If the user selects a template, load its YAML frontmatter to pre-fill title, labels, assignee, and type.
3. **Gather additional metadata** — Ask the user about optional fields:
   - **Project**: Whether to add to a GitHub project board (`gh project list` to show available projects)
   - **Milestone**: Whether to set a milestone (`gh milestone list` to show available milestones)
   - **Assignee**: Whether to self-assign or assign to another user
4. **Confirm details** — Display a summary of the issue (title, body preview, labels, type, project, milestone, assignee) and ask the user to confirm before proceeding.
5. **Duplicate check** — Run multiple search strategies to find potential duplicates:
   ```bash
   gh issue list --search "<title>" --state open --limit 5 --json title,url,state
   gh issue list --search "<keywords from title>" --state open --limit 5 --json title,url,state
   ```
   Review matching issues. If potential duplicates are found, display them (title, URL, state) and ask the user whether to proceed or cancel. Never skip the duplicate check.
6. **Create the issue** — If no duplicates (or user chooses to proceed), create the issue using `gh issue create` with all gathered information and return the issue URL.

## Commands

```bash
# List available issue templates
find .github/ISSUE_TEMPLATE -name '*.md' -o -name '*.yml' -o -name '*.yaml' 2>/dev/null

# Read a specific template
cat .github/ISSUE_TEMPLATE/<template-file>

# List available projects
gh project list --owner "<owner>" --limit 20 --json title,id,number

# List available milestones
gh milestone list --owner "<owner>" --repo "<repo>" --json title,number --state open

# List available issue types (if repo supports them)
gh issue type list

# Search for existing issues matching the title (loose match)
gh issue list --search "<title>" --state open --limit 5 --json title,url,state

# Search for existing issues matching keywords
gh issue list --search "<keywords>" --state open --limit 5 --json title,url,state

# Create the issue (only after duplicate check passes)
gh issue create \
  --title "<title>" \
  --body "<body>" \
  --label "<labels>" \
  --type "<issue_type>" \
  --assignee "<assignee>" \
  --milestone "<milestone>" \
  --project "<project>"
```

## Notes

- If no repo is specified, assume the current one (`gh repo view --json name,owner` to get owner/repo)
- Labels should be comma-separated if multiple
- Return the issue URL after creation (the `gh issue create` output includes the URL)
- Always search for duplicates before creating; never skip the duplicate check
- Use **multiple search queries** for duplicate detection — search both the exact title and extracted keywords
- If the repo uses issue forms (`.yml`/`.yaml` templates), read the form schema to understand required fields
- When no template is used, compose a well-structured body following the conventional issue format:
  - **Bug**: Steps to reproduce, expected behavior, actual behavior, environment
  - **Feature**: Problem statement, proposed solution, alternatives considered
  - **Task**: Description, acceptance criteria, dependencies
