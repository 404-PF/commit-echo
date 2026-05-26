---
name: prepare-release
description: Use this skill when asked to prepare a release. Handles version bumping, changelog generation, tagging, and verification.
---

# Prepare Release

Use this skill when the user asks to cut a release.

## Workflow

1. **Determine version** — Ask the user for the version (semver) or infer from recent commits (major/minor/patch)
2. **Check working tree** — Ensure `git status` is clean
3. **Update version** — Bump version in `package.json`
4. **Generate changelog** — Use `git log --oneline --no-decorate <last-tag>..HEAD` to collect commits since the last tag
5. **Create tag** — `git tag -a v<version> -m "Release v<version>"`
6. **Build** — Run `npm run build` to verify the project compiles
7. **Preview** — Show the user what will be released (version, changelog, tag)
8. **Push** — On confirmation: `git push && git push --tags`

## CI/CD Pipeline

Pushing the tag triggers `.github/workflows/publish.yml`; the tag push builds binaries, and creating a GitHub Release publishes the package and attaches the binaries:
- Publishes the package to **npmjs.com** (requires `NPM_TOKEN` secret)
- Publishes the package to **GitHub Packages** (uses `GITHUB_TOKEN`)
- Builds **standalone binaries** for linux-x64, macos-x64, macos-arm64, and win-x64

After pushing, create a **GitHub Release** from the tag to host the binaries as release assets.

## Notes

- Follow semver: patch for fixes, minor for features, major for breaking changes
- Do not push until the user confirms
- Ensure `NPM_TOKEN` is set in repository secrets before releasing
