# commit-echo

LLM-powered CLI that learns your Git commit style and auto-suggests personalized commit messages.

## Features

- **Style learning** — Adapts to your commit conventions over time by analyzing your history
- **Multi-provider** — Works with OpenAI, Anthropic, Ollama, and OpenAI-compatible endpoints
- **Interactive setup** — Guided wizard to configure your provider and model
- **Non-destructive** — Review and edit suggestions before committing

## Installation

```bash
npm install -g @404-pf/commit-echo
```

## Usage

```bash
# Full flow: diff, suggest, pick, commit
commit-echo

# Auto-accept and commit first suggestion
commit-echo --yes

# Interactive setup wizard
commit-echo init

# Generate suggestions without committing
commit-echo suggest

# Auto-select first suggestion (no commit)
commit-echo suggest --yes

# View learned style profile
commit-echo history
```

## Requirements

- Node.js >= 24.0.0
- A Git repository with staged changes
- An API key for your chosen LLM provider

## Configuration

Run `commit-echo init` to configure your provider and model. Configuration is stored in `~/.config/commit-echo/config.json`.

## License

MIT
