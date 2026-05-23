export class CommitEchoError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CommitEchoError";
  }
}

export class NoStagedChangesError extends CommitEchoError {
  constructor() {
    super("No staged changes found. Run `git add` first.");
    this.name = "NoStagedChangesError";
  }
}

export class ProviderError extends CommitEchoError {
  constructor(provider: string, cause: unknown) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    super(`Provider "${provider}" failed: ${msg}`, { cause: cause instanceof Error ? cause : undefined });
    this.name = "ProviderError";
  }
}

export class ConfigError extends CommitEchoError {
  constructor(message: string) {
    super(`Config error: ${message}`);
    this.name = "ConfigError";
  }
}

export class ApiKeyMissingError extends CommitEchoError {
  constructor(provider: string) {
    super(
      `No API key found for "${provider}". Set ECHO_${provider.toUpperCase()}_API_KEY or ${provider.toUpperCase()}_API_KEY env var, or run \`commit-echo init\`.`
    );
    this.name = "ApiKeyMissingError";
  }
}
