---
name: create-release
description: 'Create GitHub releases with automated versioning and changelog generation. Use for: publishing releases, creating tags, generating release notes, version bumping, semantic versioning.'
user-invocable: true
---

# Create GitHub Release

## When to Use
- Publishing a new version of your software
- Creating a GitHub release with tag and changelog
- Automating semantic versioning based on commit history
- Generating release notes from conventional commits

## Procedure

### 1. Analyze Recent Commits

Gather recent commits to determine the appropriate version bump:

```bash
# Get commits since last tag (or all commits if no tags exist)
git log --oneline --no-merges $(git describe --tags --abbrev=0 2>/dev/null || echo "HEAD")..HEAD
```

**Version determination rules:**
- **Major (X.0.0)**: If any commit contains `BREAKING CHANGE` or starts with `feat!:` or `refactor!:`
- **Minor (x.Y.0)**: If any commit starts with `feat:`
- **Patch (x.y.Z)**: For bug fixes (`fix:`), docs (`docs:`), chores (`chore:`), or other changes

### 2. Determine Next Version

```bash
# Get current version from latest tag (strip leading 'v')
LATEST_TAG=$(git describe --tags --abbrev=0 2>/dev/null | sed 's/^v//')
# Default to 0.0.0 if no tags exist
CURRENT_VERSION=${LATEST_TAG:-0.0.0}

# Parse version components
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"

# Determine bump type based on commits
# (Check for breaking changes, features, or fixes as described above)
```

### 3. Generate Changelog

Use the [update-changelog](../update-changelog/SKILL.md) skill to generate the changelog entry for this release. Follow the procedure in that skill to:

1. Categorize commits into Keep a Changelog sections (Added, Changed, Fixed, etc.)
2. Write the entry to `CHANGELOG.md`
3. Show the diff and get user confirmation before saving

### 4. Create Git Tag

```bash
# Create annotated tag
git tag -a "v$NEW_VERSION" -m "Release v$NEW_VERSION"
```

### 5. Push Tag to Remote

```bash
# Push tag to origin
git push origin "v$NEW_VERSION"
```

### 6. Create GitHub Release

Use the GitHub CLI to create the release:

```bash
# Create release with changelog body
gh release create "v$NEW_VERSION" \
  --title "Release v$NEW_VERSION" \
  --notes-file CHANGELOG.tmp

# Clean up temporary file
rm CHANGELOG.tmp
```

### 7. Verify Release

```bash
# Confirm the release was created
gh release view "v$NEW_VERSION"
```

## Completion Checklist

After executing the skill:
- [ ] Version was correctly determined from commit history
- [ ] Changelog includes all relevant commits since last release
- [ ] Git tag was created and pushed to remote
- [ ] GitHub release exists with proper title and notes
- [ ] Release is marked as latest (unless specified otherwise)

## Error Handling

- **No commits found**: If no changes since last tag, ask user to confirm if they want to proceed
- **Tag already exists**: Offer to update the existing release or choose a different version
- **Push failed**: Check for remote permissions or network issues
- **GitHub CLI not installed**: Provide installation instructions: `brew install gh` or see https://cli.github.com/

## Advanced Options

For advanced users, the skill can support:
- Pre-release versions (e.g., `v1.0.0-beta.1`)
- Draft releases (not immediately published)
- Custom release notes beyond auto-generated changelog
- Attaching binary assets to the release

## Example Usage

```
/create-release
```

The skill will:
1. Analyze commits since last tag
2. Determine next semantic version
3. Generate changelog
4. Create and push git tag
5. Create GitHub release with notes
6. Provide confirmation with release URL
