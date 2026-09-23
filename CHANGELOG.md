# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [0.3.0] - 2026-09-23

### Added
- Add PowerShell completion script support (`3270f09`)
- Add OpenRouter provider (`446252b`)
- Add custom prompt template file support via config, with template status shown in `config` output (`d351659`, `ed25575`)
- List valid providers when an unknown provider name is configured (`705685c`)
- Cache configuration in memory for the process lifetime (`e40bee0`)

### Changed
- Limit history profile parsing to recent entries for faster performance (`d9052b7`)
- Expand documentation for OS-specific config paths, batch mode, completion, config set, custom providers, and project structure (`0fead8b`, `78051c8`, `819372c`, `78dd825`, `0a84ae6`)

### Fixed
- Scope API keys to the configured provider (`0eabe9e`)
- Preserve bounded non-streaming response bodies (`2a44b90`)
- Bound prepare-commit-msg hook latency (`d63006f`)
- Detect untracked changes and reuse canonical git diff logic in batch mode (`6c01ad0`, `3fd0c5d`, `26f695c`)
- Document and uninstall managed hooks in init (`535b6b7`)
- Stream reasoning content deltas and report malformed SSE JSON (`135b68a`, `b4cdf44`)
- Time out stalled SSE body reads (`0e9d48e`)
- Handle CLI command errors consistently and preserve output before exiting (`54fbd34`, `7065e7c`)
- Stream history entry counting and serialize concurrent JSONL appends (`b610ffa`, `b7e1eea`)
- Count all imperative samples in history style analysis (`1ad77bf`)
- Preserve template path on config set and clear stale baseUrl when switching providers (`870f96d`, `c7ea3e9`, `a9fd4c6`)
- Surface Cohere model fetch errors (`9e09c2c`)
- Add verbose flag to batch suggestions in completion (`5267e85`)
- Require custom provider endpoint (`7711943`)
- Skip cancelled body prompts in batch mode (`c7a2b20`)
- Parse deprecated no-commit option (`3049029`)
- Report non-commit selections in suggest (`41f13c9`)
- Always truncate diffs at the configured size in generateSuggestions (`c58dba7`, `4a4820f`)
- Remove redundant backslash escape in API key display during init (`a44fcaf`)
- Return provider key in config JSON output (`3096eaa`)
- Resolve interactive commit suggestion issue (`3b429a9`)

### Security
- Set restrictive permissions on config file and directory (`1910b09`)
- Sanitize path interpolation in execSync for hook resolution (`731aaa9`)
- Avoid predictable temp commit-message files (`e8ca6b9`)
- Mask short API keys (`76c6e18`)
- Resolve git executable path to avoid PATH substitution (`8599d1c`)
- Pin third-party GitHub Actions to commit SHAs (`b4e45a9`)
- Disable install scripts in npm ci for publish workflow (`8a25897`)
- Omit Authorization header for keyless providers such as Ollama (`a25e564`)

## [0.2.0] - 2026-07-05

### Added
- Add `config set` command for updating configuration from the CLI (`c5fff90`)
- Add verbose diagnostics for batch mode with `--verbose` (`8b08c31`)
- Add `--max-diff-size` overrides and interactive setup support for diff truncation limits (`c4a0195`, `aa8bfcd`, `16351ae`, `8d93fbd`)
- Add `--show-diff`, `--dry-run`, and verbose output options to the suggest workflow (`a391752`, `c24ebd5`, `b20acaf`)
- Add shell completion generation for bash, zsh, and fish (`3c7a31e`)
- Add environment-variable overrides for configuration (`964c882`)
- Add example provider for local testing without API keys (`2a1bc65`)
- Add `config` and JSON-formatted `history` commands for machine-readable inspection (`16d363a`, `2f3d1cd`, `50eebed`)
- Add interactive multi-repo batch processing and streaming commit suggestions (`8fc83e1`, `6b03bfe`)
- Add automatic commit hook integration and customizable prompt templates, including `{{message}}` support (`8cd56f0`, `13b8253`, `706a3a9`)
- Add auto-accept commit mode with `--yes` and `--auto` (`82a61b1`)

### Changed
- Improve commit success output styling and cross-platform config-path handling (`a9181fc`, `1f82ca1`)
- Expand contributor and user documentation across README, CONTRIBUTING, provider guidance, and agent workflow docs (`238febe`, `7b76e34`, `d843c73`, `48e9d4a`, `dacca44`, `a522c6e`, `0cc5a37`, `c857157`, `5c35df6`, `1206a6b`)
- Add repository formatting defaults with Prettier, `.editorconfig`, and line-ending configuration (`1435719`, `ca04db6`, `3c8028e`, `6c12284`)

### Fixed
- Normalize custom init base URLs and improve missing-tool or missing-key error messages (`14acd3c`, `ca308c3`, `141f074`, `8ee1c1d`, `40aa048`, `a88c736`)
- Validate config size limits and provider request timeouts more consistently (`a0785b0`, `99e18ca`)
- Handle empty repositories, git diff failures, corrupted history entries, and separate commit/history write failures gracefully (`769a87e`, `734631b`, `ac6c7a7`, `7ef5669`)
- Preserve more suggestion formats by fixing numbered-body, bullet parsing, template rescans, and regenerate loop behavior (`2184845`, `15a939a`, `86eaad9`, `dd8787f`, `b2310d8`)
- Increase git diff buffer capacity and support per-invocation model overrides plus `--no-color` (`7ad6d1e`, `1069a2a`, `8da655e`)
