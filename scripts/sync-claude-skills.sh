#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="$ROOT_DIR/.agents/skills"
TARGET_DIR="$ROOT_DIR/.claude/skills"

# .agents/skills is the canonical source; .claude/skills is the generated mirror.
test -d "$SOURCE_DIR"

rm -rf "$TARGET_DIR"
mkdir -p "$TARGET_DIR"
cp -R "$SOURCE_DIR/." "$TARGET_DIR/"
