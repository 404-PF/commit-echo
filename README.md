# commit-echo

[![npm version](https://img.shields.io/npm/v/@404-pf/commit-echo)](https://www.npmjs.com/package/@404-pf/commit-echo)
[![License](https://img.shields.io/npm/l/@404-pf/commit-echo)](LICENSE)
[![Node.js version](https://img.shields.io/node/v/@404-pf/commit-echo)](https://www.npmjs.com/package/@404-pf/commit-echo)

LLM-powered CLI that learns your Git commit style and auto-suggests personalized commit messages.

## Features

- **Style learning** — Adapts to your commit conventions over time by analyzing your history
- **Multi-provider** — Works with OpenAI, Anthropic, Ollama, and OpenAI-compatible endpoints
- **Interactive setup** — Guided wizard to configure your provider and model
- **Git hook integration** — Optional `prepare-commit-msg` hook installation from `commit-echo init --install-hook`
- **Non-destructive** — Review and edit suggestions before committing

## Installation

```bash
npm install -g @404-pf/commit-echo
```

## Development

To build and run the CLI locally without a global install:

```bash
npm install
npm run build
node dist/index.js suggest
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full setup and contribution workflow.

## Usage

```bash
# Full flow: diff, suggest, pick, commit
commit-echo

# Auto-accept and commit first suggestion
commit-echo --yes

# Interactive setup wizard
commit-echo init

# Interactive setup and install a prepare-commit-msg hook
commit-echo init --install-hook

# Generate suggestions without committing
commit-echo suggest

# Auto-select first suggestion (no commit)
commit-echo suggest --yes

# View learned style profile
commit-echo history
```

Note: The non-interactive flags `--yes`, `-y`, and `--auto` expect staged changes (run `git add`). If no staged changes are found when auto-committing is requested, the command will print an error and exit with a non-zero status.

## Requirements

- Node.js >= 24.0.0
- A Git repository with staged changes
- An API key for your chosen LLM provider

## Configuration

Run `commit-echo init` to configure your provider and model. Configuration is stored in `~/.config/commit-echo/config.json`.

If you want `git commit` to prefill the first suggestion automatically, run `commit-echo init --install-hook` from inside a Git repository. This installs both a `prepare-commit-msg` hook (prefills the first suggestion) and a `post-commit` hook (logs the committed message for style learning). The hooks skip merge commits, cherry-picks, amend flows, and any commit where a message was already supplied.

### Options

| Option | Default | Description |
|---|---|---|
| `provider` | — | LLM provider key (e.g., `openai`, `anthropic`, `ollama`) |
| `model` | — | Model name to use for generation |
| `historySize` | `50` | Number of recent commits to learn style from |
| `maxDiffSize` | `4000` | Maximum diff size (in characters) sent to the LLM. Diffs exceeding this limit are intelligently truncated — file headers are preserved while line-level content is dropped from overflow files. Adjust upward for large refactors or generated-file changes. |

### Custom Prompt Templates

You can override the built-in system and user prompts by setting `systemPromptTemplate` and/or `userPromptTemplate` in `config.json`. This is useful for enforcing project-specific commit conventions (e.g., Jira ticket prefixes, Gerrit Change-Id footers, Signed-off-by lines).

Run `commit-echo init` and answer "Yes" when asked about custom prompt templates, or edit `config.json` directly:

```json
{
  "systemPromptTemplate": "You are a commit assistant for the Acme project.\nAlways include a Jira ticket reference.\n\n{{profile}}",
  "userPromptTemplate": "Generate 3 conventional commits for this diff on branch {{branch}}:\n\n{{diff}}"
}
```

#### Template Variables

| Variable | Description |
|----------|-------------|
| `{{diff}}` | The git diff text |
| `{{profile}}` | The learned style profile summary |
| `{{branch}}` | Current git branch name |
| `{{message}}` | *(reserved)* Previous commit message context |

If a custom template is not set, the built-in prompt is used as a fallback.

## Quickstart

### Environment

Set the API key for the provider you plan to use before running the setup wizard or generating suggestions. The table below lists all built-in providers, their API key environment variables, and whether a key is required.

| Provider key | Display name | API key env var | Required? |
|---|---|---|---|
| `openai` | OpenAI | `OPENAI_API_KEY` | Yes |
| `anthropic` | Anthropic | `ANTHROPIC_API_KEY` | Yes |
| `google` | Google Gemini | `GOOGLE_API_KEY` | Yes |
| `mistral` | Mistral | `MISTRAL_API_KEY` | Yes |
| `groq` | Groq | `GROQ_API_KEY` | Yes |
| `cohere` | Cohere | `COHERE_API_KEY` | Yes |
| `deepseek` | DeepSeek | `DEEPSEEK_API_KEY` | Yes |
| `ollama` | Ollama | `OLLAMA_API_KEY` | No / optional for local Ollama |
| `together` | Together AI | `TOGETHER_API_KEY` | Yes |
| `fireworks` | Fireworks AI | `FIREWORKS_API_KEY` | Yes |

> **Note:** Ollama uses the local server at `http://localhost:11434/v1` and normally does not require an API key; the env var is only relevant if your local setup expects one.

Example (macOS / Linux):

```bash
export OPENAI_API_KEY=sk-example
```

Example (Windows PowerShell):

```powershell
$env:OPENAI_API_KEY = "sk-example"
```

Example (Windows CMD):

```cmd
set OPENAI_API_KEY=sk-example
```

### Full flow: review staged changes and commit

```bash
git add .
commit-echo
```

Sample output:

```text
commit-echo
  1. feat: add release summary command
  2. fix: guard empty commit history
  3. docs: clarify init workflow
```

### Interactive setup

```bash
commit-echo init
```

What it does:
- lets you pick a provider
- helps you choose a model
- saves the config to `~/.config/commit-echo/config.json`

### Generate suggestions without committing

```bash
commit-echo suggest --no-commit
```

Sample output:

```text
Suggestions generated:
  1. fix: handle empty staged diff
  2. test: cover custom provider validation
  3. chore: refresh package metadata
```

### Stream suggestions as they are generated

Use `--stream` to print LLM output incrementally instead of waiting behind a spinner. Supported for OpenAI-compatible and Anthropic providers; use non-streaming mode for Cohere. Pair with `--yes` for a non-interactive workflow that streams output and auto-commits the first suggestion.

```bash
commit-echo suggest --stream
commit-echo suggest --stream --yes
```

### Inspect suggestion diagnostics with `--verbose`

Use verbose mode when you want to confirm which model handled the request, how much commit history was folded into the style profile, or whether the diff had to be truncated before sending it to the provider.

```bash
commit-echo suggest --verbose
```

Sample output:

```text
Suggestions generated:
Model: gpt-4o
Style profile: 5 commit(s), avg length 31.4, imperative rate 80.0%, common prefixes: feat, fix, docs
Truncation: not applied
  1. fix: handle empty staged diff
  2. test: cover custom provider validation
  3. chore: refresh package metadata
```

Verbose fields:

- `Model` shows the resolved model name after any `--model` override is applied.
- `Style profile` summarizes the recent commit history used for tone and structure: how many commits were sampled, the average subject length, the share of imperative subjects, and the most common prefixes.
- `Truncation` tells you whether `maxDiffSize` trimmed the staged diff before generation. If truncation happens, the CLI also prints a warning with the original and reduced character counts.

### View learned style history

```bash
commit-echo history
```

Sample output:

```text
Recent commit style
- prefix frequency: fix, feat, docs
- average subject length: 42
- recent bodies: 6
```

## Troubleshooting

- **`No configuration found`** — run `commit-echo init` first.
- **`No changes detected`** — stage files with `git add` or make an unstaged edit before running `commit-echo suggest`.
- **Provider auth errors** — confirm the matching environment variable (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or your custom provider key) is set in the same shell session.
- **Wrong repository context** — run the command inside a Git repository so `commit-echo` can read the diff and history.

## License

MIT
