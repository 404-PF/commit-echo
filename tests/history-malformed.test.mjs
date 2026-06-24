import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { countEntries, loadEntries } from "../dist/history/store.js";

/**
 * Returns the OS-specific config directory inside `homeDir`.
 * Mirrors the helper used in existing history test files.
 */
function configDirFor(homeDir) {
  return process.platform === "win32"
    ? join(homeDir, "AppData", "Roaming", "commit-echo")
    : join(homeDir, ".config", "commit-echo");
}

function writeRawHistory(homeDir, lines) {
  const configDir = configDirFor(homeDir);
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "history.jsonl"), lines.join("\n") + "\n", "utf-8");
}

function setupHome() {
  const home = mkdtempSync(join(tmpdir(), "commit-echo-malformed-"));
  process.env.HOME = home;
  process.env.APPDATA = join(home, "AppData", "Roaming");
  process.env.XDG_CONFIG_HOME = "";
  return home;
}

function teardownHome(home, previousEnv) {
  rmSync(home, { recursive: true, force: true });
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

// ── loadEntries with malformed lines ────────────────────────────────────

test("loadEntries skips malformed JSON lines and returns only valid entries", async () => {
  const previousEnv = {
    HOME: process.env.HOME,
    APPDATA: process.env.APPDATA,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  };
  const home = setupHome();

  try {
    writeRawHistory(home, [
      '{bad json',
      JSON.stringify({
        timestamp: "2026-05-30T12:00:00Z",
        message: "valid: fix bug",
        diff: "",
        model: "test",
        provider: "openai",
      }),
      "also invalid[",
      JSON.stringify({
        timestamp: "2026-05-30T13:00:00Z",
        message: "valid: add feature",
        diff: "",
        model: "test",
        provider: "openai",
      }),
    ]);

    const entries = await loadEntries();
    assert.equal(entries.length, 2);
    assert.equal(entries[0].message, "valid: add feature"); // most recent first
    assert.equal(entries[1].message, "valid: fix bug");
  } finally {
    teardownHome(home, previousEnv);
  }
});

test("loadEntries returns empty array when all lines are malformed", async () => {
  const previousEnv = {
    HOME: process.env.HOME,
    APPDATA: process.env.APPDATA,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  };
  const home = setupHome();

  try {
    writeRawHistory(home, ["{not json", "also bad[", "garbage line"]);

    const entries = await loadEntries();
    assert.equal(entries.length, 0);
  } finally {
    teardownHome(home, previousEnv);
  }
});

// ── countEntries with malformed lines ───────────────────────────────────

test("countEntries counts all non-empty lines including malformed JSON", async () => {
  const previousEnv = {
    HOME: process.env.HOME,
    APPDATA: process.env.APPDATA,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  };
  const home = setupHome();

  try {
    writeRawHistory(home, [
      JSON.stringify({
        timestamp: "2026-05-30T12:00:00Z",
        message: "valid",
        diff: "",
        model: "test",
        provider: "openai",
      }),
      "{invalid json line",
      "",
      "   ",
    ]);

    const count = await countEntries();
    // 3 non-empty entries: 1 valid + 1 malformed + 1 whitespace (split+filter(Boolean))
    assert.equal(count, 3);
  } finally {
    teardownHome(home, previousEnv);
  }
});

test("countEntries returns 0 when file does not exist", async () => {
  const previousEnv = {
    HOME: process.env.HOME,
    APPDATA: process.env.APPDATA,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  };
  const home = mkdtempSync(join(tmpdir(), "commit-echo-nofile-"));
  process.env.HOME = home;
  process.env.APPDATA = join(home, "AppData", "Roaming");
  process.env.XDG_CONFIG_HOME = "";

  try {
    const count = await countEntries();
    assert.equal(count, 0);
  } finally {
    teardownHome(home, previousEnv);
  }
});
