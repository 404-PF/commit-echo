---
name: prepare-release
description: Use this skill when asked to prepare a release. Handles version bumping from conventional commits, changelog generation, tagging, GitHub release creation, and verification.
---

# Prepare Release

Use this skill when the user asks to cut a release.

## Workflow

1. **Check working tree** — Ensure `git status --porcelain` is clean. If not, ask the user to commit or stash changes first.

2. **Determine version** — Use one of these strategies (in order of preference):
   a. If the user specifies a version explicitly, use it
   b. Analyze commits since the last tag using conventional commits to auto-determine the bump:
      - `feat!:` or `fix!:` or any commit with `BREAKING CHANGE` → **major** bump
      - `feat:` → **minor** bump
      - `fix:`, `chore:`, `docs:`, `refactor:`, `perf:`, `test:`, `build:`, `ci:`, `style:` → **patch** bump
   c. Ask the user to choose from suggested bump types (major/minor/patch)

3. **Preview version** — Show the current version, the new version, and the bump type. Ask the user to confirm.

4. **Update version** — Bump version in `package.json` (and other relevant files like `package-lock.json`, `Cargo.toml`, etc.):
   ```bash
   npm version <major|minor|patch> --no-git-tag-version
   ```
   Or manually edit the version field.

5. **Generate changelog** — Analyze commits since the last tag and format them using the [Keep a Changelog](https://keepachangelog.com/) standard:
   - Categorize commits by type: **Features**, **Bug Fixes**, **Documentation**, **Performance**, **Refactoring**, **Deprecated**, **Removed**, **Security**
   - Group under the new version heading
   - Include links to relevant issues/PRs if mentioned in commits
   - If a `CHANGELOG.md` already exists, prepend the new entries

   ```bash
   # Get commits since last tag, grouped by conventional commit type
   git log <last-tag>..HEAD --format="%s (%h)" --no-decorate | while IFS= read -r line; do
     case "$line" in
       feat!*) echo "### Breaking Changes"; echo "- $line";;
       feat:*) echo "### Features"; echo "- $line";;
       fix:*)  echo "### Bug Fixes"; echo "- $line";;
       # ... etc
     esac
   done
   ```

6. **Commit the version bump and changelog** — Create a single commit with the changes:
   ```bash
   git add package.json CHANGELOG.md
   git commit -m "chore(release): v<version>"
   ```

7. **Create tag** — Create an annotated tag:
   ```bash
   git tag -a v<version> -m "Release v<version>"
   ```

8. **Build & test verification** — Run the project's build and test commands to ensure everything is in order:
   ```bash
   npm run build
   npm test
   ```
   If build or tests fail, stop and report the issue.

9. **Preview** — Show the user a complete summary of what will be released:
   - Current version → new version
   - Bump type (major/minor/patch)
   - Changelog entries
   - Tag name
   - List of commits included
   - Build status

10. **Push** — On user confirmation:
    ```bash
    git push && git push --tags
    ```

11. **Create GitHub Release** — After pushing, create a GitHub Release from the tag with the changelog content:
    ```bash
    gh release create v<version> \
      --title "v<version>" \
      --notes "<changelog-entries>" \
      --latest
    ```

## CI/CD Pipeline

The tag push and GitHub Release trigger `.github/workflows/publish.yml`:
- Publishes the package to **npmjs.com** (requires `NPM_TOKEN` secret)
- Publishes the package to **GitHub Packages** (uses `GITHUB_TOKEN`)
- Builds **standalone binaries** for linux-x64, macos-x64, macos-arm64, and win-x64

## Notes

- Follow semver strictly: patch for fixes, minor for features, major for breaking changes
- Use conventional commits (`feat:`, `fix:`, `feat!:`, etc.) to auto-determine version bumps
- Detect breaking changes in commit messages with `BREAKING CHANGE:` footer or `!` after the type
- Do **not** push or publish until the user explicitly confirms
- Ensure `NPM_TOKEN` is set in repository secrets before releasing to npm
- If the repo has not been tagged yet, use `git log --reverse` to find the first meaningful commit as the starting point
- For pre-release versions (alpha, beta, rc), use `npm version <bump> --preid <tag>` to generate versions like `1.0.0-alpha.1`
- The `gh release create` step is optional — skip if the user only wants a git tag
