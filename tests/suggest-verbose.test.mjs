import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function configDirFor(home) {
  if (platform() === "darwin")
    return join(home, "Library", "Application Support", "commit-echo");
  if (platform() === "win32")
    return join(home, "AppData", "Roaming", "commit-echo");
  return join(home, ".config", "commit-echo");
}

test("suggestCommand prints verbose diagnostics when requested", async () => {
  const root = mkdtempSync(join(tmpdir(), "commit-echo-verbose-"));
  const home = join(root, "home");
  const repo = join(root, "repo");
  mkdirSync(home, { recursive: true });
  mkdirSync(repo, { recursive: true });

  execFileSync("git", ["init"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "Verbose Tester"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "verbose@example.com"], {
    cwd: repo,
  });
  writeFileSync(join(repo, "README.md"), "# fixture\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: repo });
  execFileSync("git", ["commit", "-m", "feat: initial fixture"], { cwd: repo });
  writeFileSync(join(repo, "README.md"), "# fixture\n\nupdated\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: repo });

  const server = createServer((req, res) => {
    if (req.url === "/chat/completions" && req.method === "POST") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          model: "fixture-model",
          choices: [
            { message: { content: "1. feat: add verbose diagnostics" } },
          ],
        }),
      );
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  const previousCwd = process.cwd();
  const previousEnv = {
    HOME: process.env.HOME,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    APPDATA: process.env.APPDATA,
    FORCE_COLOR: process.env.FORCE_COLOR,
  };
  const originalLog = console.log;
  let stdout = "";

  try {
    const port = await listen(server);
    const configDir = configDirFor(home);
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({
        provider: "__custom__",
        model: "fixture-model",
        baseUrl: `http://127.0.0.1:${port}`,
        apiKey: "test-key",
        historySize: 5,
        maxDiffSize: 4000,
      }),
      "utf8",
    );

    process.chdir(repo);
    process.env.HOME = home;
    process.env.XDG_CONFIG_HOME = join(home, ".config");
    process.env.APPDATA = join(home, "AppData", "Roaming");
    process.env.FORCE_COLOR = "0";
    console.log = (...args) => {
      stdout += `${args.join(" ")}\n`;
    };

    const { suggestCommand } = await import("../dist/commands/suggest.js");
    await suggestCommand({ commit: false, autoCommit: true, verbose: true });

    assert.match(stdout, /Model: fixture-model/);
    assert.match(stdout, /Style profile:/);
    assert.match(stdout, /Truncation: not applied/);
    assert.match(stdout, /feat: add verbose diagnostics/);
  } finally {
    console.log = originalLog;
    process.chdir(previousCwd);
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
