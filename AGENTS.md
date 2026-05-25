# commit-echo

## Build & Run

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript
npm start            # Run (requires: node dist/index.js)
```

## Test

```bash
# Lint (add eslint if desired)
npm run build        # Verify TypeScript compilation
node dist/index.js   # Smoke test the CLI
```

## Architecture

- `src/index.ts` — CLI entry point (Commander)
- `src/commands/` — Command implementations
- `src/providers/` — LLM provider adapters
- `src/config/store.ts` — Config persistence
- `src/history/store.ts` — History JSONL + style learner
- `src/llm/` — Prompt builder + API client
- `src/git/diff.ts` — Git operations via execSync

## Commands

- `commit-echo` — Full flow (diff, suggest, pick, commit)
- `commit-echo init` — Interactive setup wizard
- `commit-echo suggest` — Generate suggestions without committing
- `commit-echo history` — View learned style profile
