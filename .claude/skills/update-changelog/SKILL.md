---
name: update-changelog
description: 'Generate or update a changelog entry from git commit history. Use when: writing changelogs, generating release notes, summarizing changes between versions, creating CHANGELOG.md entries, preparing releases.'
user-invocable: true
argument-hint: '[version] (e.g. 1.2.0, unreleased)'
---

# Update Changelog

Generate a [Keep a Changelog](https://keepachangelog.com/) formatted entry from recent git history.

## Procedure

### 1. Determine the Version

- If the user provided a version argument, use it.
- If no version is provided, ask the user: "What version should this entry be labeled as? (e.g., `1.2.0` or `Unreleased`)"

### 2. Determine the Commit Range

Find the starting point for the changelog entry:

- Check if a CHANGELOG.md exists. If it does, scan it for the most recent version header to understand the existing format.
- Find the latest git tag with `git describe --tags --abbrev=0`.
- If the user specifies a starting point (commit, tag, or date), set `start` to that value.
- Otherwise, if a tag exists, set `start` to the latest tag.
- Confirm the selected range with the user before categorizing it.

Set `start` to the latest tag or user-specified starting point. If `start` is set, run `git log "$start"..HEAD --oneline`; only when no tag exists and no starting point was given, run `git log --oneline --no-merges HEAD`.

### 3. Categorize Commits

Map commits into Keep a Changelog sections using commit message prefixes and content:

| Section | Conventional Prefix | Fallback Keywords |
|---------|--------------------|--------------------|
| **Added** | `feat`, `add`, `new` | new file, new feature, implement |
| **Changed** | `refactor`, `update`, `change`, `improve`, `perf`, `style`, `build` | update, modify, enhance, migrate, upgrade |
| **Deprecated** | `deprecate` | deprecated, will be removed |
| **Removed** | `remove` | remove, delete, drop |
| **Fixed** | `fix`, `bugfix` | bug, fix, patch, resolve, handle error |
| **Security** | `security`, `cve` | vulnerability, CVE, security fix |

- Skip commits that are clearly automated: merge commits, version bumps (`bump version`, `chore: release`), CI config only.
- If a commit doesn't fit any section, skip it and note it to the user.

### 4. Format the Entry

Output a markdown block like this:

```markdown
## [Unreleased]

### Added
- Feature description (`abc1234`)

### Fixed
- Bug fix description (`def5678`)

### Changed
- Change description (`ghi9012`)
```

Rules:
- Use short commit hashes in backticks at the end of each entry.
- If the commit message is clear and concise, adapt it as the entry description.
- If the commit message is unclear, read the actual diff (`git show <hash> --stat`) to write a better description.
- Avoid internal jargon — write for end users.
- Use the imperative mood ("Add support for…" not "Added support for…" or "Adds…").

### 5. Write or Append to CHANGELOG.md

Build the proposed change before modifying the file:

- If `CHANGELOG.md` exists, construct the new entry in memory and prepare a unified diff against the current file. Insert the entry after the `# Changelog` header (or after any "Keep a Changelog" preamble) and avoid duplicates.
- If `CHANGELOG.md` does not exist, construct the complete file in memory using the standard preamble:

```markdown
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).
```

- Show the proposed diff to the user and request explicit confirmation.
- Only after the user confirms, write or append the entry to `CHANGELOG.md`. Do not modify the file before confirmation.

### 6. Finalize

- Print a summary: how many commits were categorized, how many were skipped.
- If the version is `Unreleased`, remind the user to update it to a real version before tagging a release.

## Tips

- For projects using conventional commits, the categorization is nearly automatic.
- For projects without conventional commits, rely more heavily on `git show` and manual interpretation.
- If the repo has a `package.json` or `Cargo.toml`, you can read the current version from there to suggest a label.
