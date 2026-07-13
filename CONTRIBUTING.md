# Contributing to commit-echo

## Getting Started

1. **Fork and clone** the repository.
2. **Install dependencies:**
   ```bash
   npm install
   ```
3. **Build the project:**
   ```bash
   npm run build
   ```
4. **Run a smoke test:**
   ```bash
   node dist/index.js --help
   ```

## Development Workflow

- TypeScript source lives in `src/`.
- Run `npm run build` to compile – no separate dev server needed.
- Before opening a PR, ensure the project builds cleanly.

## Testing

- Run `npm test` to run all the test cases.
- Project uses Node.js's built-in node:test framework for testing.
- Test files are located in `tests/` and `tests/e2e/`.
- E2E tests spin up a local HTTP server and create real Git repositories during execution. As a result, they may take longer to run than unit tests. 


## Project Structure

```
src/
├── index.ts              # CLI entry point (Commander) — registers all commands
├── types.ts              # Shared TypeScript interfaces (Config, Provider, Suggestion, etc.)
├── commands/
│   ├── init.ts           # Interactive setup wizard (clack/prompts) — provider, model, API key
│   ├── suggest.ts        # Core suggestion flow: diff → LLM → display → optional commit
│   ├── history.ts        # View learned style profile and recent commit history
│   ├── config.ts         # View current config
│   ├── batch.ts          # Process multiple git repos in batch mode
│   └── completion.ts     # Generate shell completion scripts (bash, zsh, fish)
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

## Code Conventions

- **Style:** Minimal, no comments unless necessary. Match the existing code style.
- **Imports:** Use ESM `import` syntax (`"type": "module"`).
- **Formatting:** Prettier is configured via `.prettierrc`. Run `npm run format` to auto-format the supported source files, or `npm run format:check` to verify formatting in CI.
- **No linter is configured** – review your own diffs carefully.

## Pull Request Process

1. Create a feature branch from `main`.
2. Make your changes and verify `npm run build` succeeds.
3. Keep PRs focused – one feature or fix per PR.
4. Write a clear, concise PR description explaining what and why.

## Issue Templates

When opening an issue, use the closest template from `.github/ISSUE_TEMPLATE/`:

- **Bug report** for reproducible defects
- **Feature request** for product or workflow improvements
- **Good first issue** for small, newcomer-friendly tasks with clear acceptance criteria

## Adding a New LLM Provider

1. Create a file in `src/providers/` implementing the provider interface from `src/types.ts`.
2. Add a new entry to the `BUILTIN_PROVIDERS` array in `src/providers/registry.ts` with the following fields:
   - `key`: Unique identifier (e.g., `my-provider`)
   - `name`: Display name (e.g., `My Provider`)
   - `baseUrl`: API base URL
   - `apiKeyEnv`: Environment variable name for the API key (e.g., `MY_PROVIDER_API_KEY`)
   - `website`: Provider website URL
   - `docsUrl`: Provider documentation URL
   - `needsApiKey`: `true` if an API key is required, `false` for local providers like Ollama
3. Add any needed configuration keys in `src/config/`.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
