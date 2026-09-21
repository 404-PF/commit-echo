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

Gather recent commits to determine the appropriate version bump. Use the full history when the repository has no tags:

```bash
LATEST_TAG="$(git describe --tags --abbrev=0 2>/dev/null || true)"
if [ -n "$LATEST_TAG" ]; then
  git log --oneline --no-merges "$LATEST_TAG..HEAD"
else
  git log --oneline --no-merges HEAD
fi
```

**Version determination rules:**
- **Major (X.0.0)**: If any commit contains `BREAKING CHANGE` or starts with `feat!:` or `refactor!:`
- **Minor (x.Y.0)**: If any commit starts with `feat:`
- **Patch (x.y.Z)**: For bug fixes (`fix:`), docs (`docs:`), chores (`chore:`), or other changes

### 2. Determine Next Version

```bash
LATEST_TAG="$(git describe --tags --abbrev=0 2>/dev/null || true)"
if [ -n "$LATEST_TAG" ]; then
  CURRENT_VERSION="$(printf '%s' "$LATEST_TAG" | sed 's/^v//')"
else
  CURRENT_VERSION="$(node -p "require('./package.json').version")"
fi

if [ -z "$CURRENT_VERSION" ] || [ "$CURRENT_VERSION" = "undefined" ]; then
  echo "No release baseline is available; provide the current version explicitly."
  exit 1
fi

# Parse version components
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"

# Determine bump type based on commits
# (Check for breaking changes, features, or fixes as described above)
```

When no tag exists, use `package.json` as the version baseline; do not default to `0.0.0`. If `package.json` cannot be read, require the user to provide the current version explicitly.

### 3. Generate Changelog

Use the [update-changelog](../update-changelog/SKILL.md) skill to generate the changelog entry for this release. Invoke it with `NEW_VERSION` as its version argument and follow its procedure to:

1. Categorize commits into Keep a Changelog sections (Added, Changed, Fixed, etc.)
2. Build and show the proposed diff
3. After explicit user confirmation, write the entry to `CHANGELOG.md`

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

Use the GitHub CLI to create the release. Extract only the newly generated version section into a temporary notes file:

```bash
release_notes_file="$(mktemp)"
awk -v section="## [$NEW_VERSION]" '
  $0 == section || index($0, section " -") == 1 { in_section=1; next }
  in_section && $0 ~ /^## / { exit }
  in_section { print }
' CHANGELOG.md >"$release_notes_file"
test -s "$release_notes_file"

gh release create "v$NEW_VERSION" \
  --title "Release v$NEW_VERSION" \
  --notes-file "$release_notes_file"

rm -f "$release_notes_file"
```

The temporary file is created from `CHANGELOG.md` after the changelog confirmation step; never point cleanup at `CHANGELOG.md` itself.

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
