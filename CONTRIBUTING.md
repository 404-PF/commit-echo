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

## Project Structure

```
src/
├── index.ts          # CLI entry point (Commander)
├── types.ts          # Shared types
├── commands/         # Command implementations (init, suggest, history)
├── config/           # Config persistence
├── git/              # Git operations (diff)
├── history/          # History JSONL + style learner
├── llm/              # Prompt builder + API client
└── providers/        # LLM provider adapters
```

## Code Conventions

- **Style:** Minimal, no comments unless necessary. Match the existing code style.
- **Imports:** Use ESM `import` syntax (`"type": "module"`).
- **Formatting:** The project does not currently enforce a formatter – keep code clean and consistent with surrounding files.
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
2. Register it in the provider lookup logic.
3. Add any needed configuration keys in `src/config/`.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
