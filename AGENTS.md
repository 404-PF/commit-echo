# commit-echo

## Build & Run

```bash
npm install          # Install dependencies (Node >=24 required)
npm run build        # Compile TypeScript (tsc)
npm start            # Run (requires: node dist/index.js)
```

## Test

```bash
npm test             # Build + run all tests via Node built-in test runner
npm run format       # Auto-format with Prettier
npm run format:check # Verify formatting (CI)
```

Tests use **Node.js built-in `node:test`** (not Jest/Mocha). Test files are `.mjs` in `tests/` and `tests/e2e/`. E2E tests create real temp Git repos and local HTTP servers. Some tests skip on Windows (platform-specific mock logic).

## Architecture

```
src/
├── index.ts              # CLI entry point (Commander) — registers all commands
├── types.ts              # Shared TypeScript interfaces (Config, Provider, Suggestion, etc.)
├── commands/
│   ├── init.ts           # Interactive setup wizard (clack/prompts) — provider, model, API key
│   ├── suggest.ts        # Core suggestion flow: diff → LLM → display → optional commit
│   ├── history.ts        # View learned style profile and recent commit history
│   ├── config.ts         # View current config
│   └── batch.ts          # Process multiple git repos in batch mode
├── providers/
│   ├── index.ts          # Provider factory: createProvider(), complete(), completeStream(), fetchModels()
│   ├── registry.ts       # BUILTIN_PROVIDERS array (OpenAI, Anthropic, Google, Mistral, etc.)
│   ├── openai-compatible.ts  # Default adapter for OpenAI-compatible APIs (most providers)
│   ├── anthropic.ts      # Anthropic-specific adapter (Messages API)
│   ├── cohere.ts         # Cohere-specific adapter
│   ├── example.ts        # No-op example provider for testing
│   ├── request.ts        # Shared HTTP request helpers
│   └── sse.ts            # Server-Sent Events streaming parser
├── llm/
│   ├── client.ts         # generateSuggestions() — orchestrates config → prompt → LLM → parse
│   └── prompt.ts         # buildSystemPrompt(), buildUserPrompt(), template vars, diff truncation
├── git/
│   ├── diff.ts           # Git ops: getStagedDiff(), getUnstagedDiff(), commit(), checkGitRepo()
│   └── hook.ts           # Git hook management: prepare-commit-msg, post-commit
├── history/
│   └── store.ts          # JSONL history: loadEntries(), appendEntry(), buildProfile(), formatProfile()
└── config/
    └── store.ts          # Config persistence: loadConfig(), saveConfig(), env var overrides
```

## Key Design Patterns

- **ESM-only**: `"type": "module"` in package.json. All imports use `.js` extensions (`from './foo.js'`). `verbatimModuleSyntax` is enabled in tsconfig.
- **Zero runtime dependencies for LLM**: Only 3 deps — `commander` (CLI), `@clack/prompts` (interactive UI), `picocolors` (terminal colors).
- **Provider abstraction**: All LLM providers implement the `Provider` interface from `types.ts`. Most use the OpenAI-compatible adapter; only Anthropic and Cohere have custom implementations.
- **Config via env vars**: All config keys can be overridden with `COMMIT_ECHO_*` env vars (e.g., `COMMIT_ECHO_PROVIDER`, `COMMIT_ECHO_MODEL`). See `CONFIG_ENV_VARS` in `config/store.ts`.
- **Config directory**: OS-aware (`~/.config/commit-echo` on Linux, `~/Library/Application Support/commit-echo` on macOS, `%APPDATA%/commit-echo` on Windows).
- **Git operations**: Use `execSync`/`spawnSync` — no `simple-git` dependency. Diff buffer is 100MB. Commits use temp files (`git commit -F`).
- **Style learning**: History stored as JSONL. `buildProfile()` analyzes recent commits for patterns (imperative mood, common prefixes, scope usage, body usage). The profile is injected into the system prompt as style guidance.
- **Template variables**: Custom prompt templates support `{{diff}}`, `{{profile}}`, `{{branch}}`, `{{message}}`.
- **Streaming**: Supported via SSE parsing (`providers/sse.ts`). Enabled with `--stream` flag on the `suggest` command.

## Commands

| Command | Description |
|---|---|
| `commit-echo` | Default: stage → diff → suggest → pick → commit |
| `commit-echo init` | Interactive setup wizard (provider, model, API key, optional hook install) |
| `commit-echo suggest` | Generate suggestions without committing |
| `commit-echo suggest --commit` | Generate and commit |
| `commit-echo suggest --stream` | Stream suggestions progressively |
| `commit-echo suggest --dry-run` | Show LLM input without calling the API |
| `commit-echo history` | View learned style profile and recent commits |
| `commit-echo history --json` | Output history as JSON |
| `commit-echo config` | View current configuration |
| `commit-echo batch [dir]` | Process multiple repos (add `--recursive` for nested) |

Global flags: `--yes`/`--auto` (auto-accept first suggestion), `--no-color`.

## Conventions

- **Code style**: Minimal comments. Prettier: single quotes, trailing commas, 2-space indent, 120 print width.
- **No linter**: Review diffs carefully; no ESLint configured.
- **Error handling**: Commands catch errors and display via `outro(pc.red(...))`. Library code throws errors directly.
- **UI**: Uses `@clack/prompts` for interactive prompts (intro/outro/select/text/confirm/spinner). Colors via `picocolors`.
- **Imports**: Always use `.js` extension for local imports. Import types with `import type`.
- **Testing**: Files are `.mjs` (not `.ts`). Use `node:assert/strict` and `node:test`. E2E tests use real git repos in temp dirs.

## Provider System

Adding a new provider:
1. Create `src/providers/my-provider.ts` implementing the `Provider` interface
2. Add entry to `BUILTIN_PROVIDERS` in `src/providers/registry.ts`
3. Add adapter logic in `src/providers/index.ts`'s `createProvider()` factory

The `example` provider is a no-op provider useful for testing without an API key.

## Skills

The project includes reusable agent skills in `.agents/skills/` for common GitHub workflows:

| Skill | Description |
|---|---|
| [checkout-branch](.agents/skills/checkout-branch/SKILL.md) | Create and switch to a new branch from a name or GitHub issue number |
| [commit](.agents/skills/commit/SKILL.md) | Stage changes, write conventional commit messages, and commit |
| [create-issue](.agents/skills/create-issue/SKILL.md) | Create GitHub issues with templates, duplicate detection, project/milestone assignment |
| [create-pr](.agents/skills/create-pr/SKILL.md) | Create pull requests with templates, commit log summaries, reviewer/issue linking |
| [create-release](.agents/skills/create-release/SKILL.md) | Create GitHub releases with automated versioning and changelog generation |
| [patch-findings](.agents/skills/patch-findings/SKILL.md) | Generate fix patches from pre-identified findings (PR reviews, scans) |
| [resolve-issue](.agents/skills/resolve-issue/SKILL.md) | Systematically resolve GitHub issues from assignment through PR creation |
| [review-changes](.agents/skills/review-changes/SKILL.md) | Pre-commit code review checklist for staged and unstaged changes |
| [review-pr](.agents/skills/review-pr/SKILL.md) | Review pull requests for quality, issues, and improvements |
| [scan-features](.agents/skills/scan-features/SKILL.md) | Scan codebase for missing features and open GitHub issues |
| [scan-issues](.agents/skills/scan-issues/SKILL.md) | Scan codebase for bugs, security issues, and code smells |
| [update-changelog](.agents/skills/update-changelog/SKILL.md) | Generate changelog entries from git commit history |
