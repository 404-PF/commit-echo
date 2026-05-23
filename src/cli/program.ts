import { Command } from "commander";
import { readFileSync } from "node:fs";
import { URL } from "node:url";

function getVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf-8")
    );
    return pkg.version ?? "0.1.0";
  } catch {
    return "0.1.0";
  }
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name("commit-echo")
    .description("LLM-powered CLI that learns your commit style & auto-suggests personalized Git messages")
    .version(getVersion(), "-V, --version", "Show version number");

  program
    .command("init")
    .description("Run the interactive first-time setup wizard")
    .action(async () => {
      const { runInit } = await import("./init.js");
      await runInit();
    });

  program
    .command("generate")
    .alias("gen")
    .description("Generate a commit message for staged changes")
    .option("-p, --provider <name>", "LLM provider to use (overrides config)")
    .option("-m, --model <name>", "Model to use (overrides config)")
    .action(async (options) => {
      const { runGenerate } = await import("./generate.js");
      await runGenerate(options);
    });

  program
    .command("commit")
    .alias("cm")
    .description("Generate a commit message and commit staged changes")
    .option("-p, --provider <name>", "LLM provider to use (overrides config)")
    .option("-m, --model <name>", "Model to use (overrides config)")
    .action(async (options) => {
      const { runCommit } = await import("./commit.js");
      await runCommit(options);
    });

  program
    .command("config")
    .description("View current configuration")
    .option("-l, --list", "List full configuration")
    .action(async (options) => {
      const { runConfig } = await import("./config-view.js");
      await runConfig(options);
    });

  program
    .command("learn")
    .description("Force re-learn commit style from git history")
    .action(async () => {
      const { learnStyle } = await import("../learning/profile.js");
      await learnStyle();
    });

  // Default: run generate when no command is given
  program.action(async () => {
    const { runGenerate } = await import("./generate.js");
    await runGenerate();
  });

  return program;
}
