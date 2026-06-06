import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import test from "node:test";

import { getConfigPath, loadConfig } from "../dist/config/store.js";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("loadConfig reports invalid JSON with the config path and fix hint", async () => {
  const originalHome = process.env.HOME;
  const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
  const originalAppData = process.env.APPDATA;
  const home = await mkdtemp(`${tmpdir()}/commit-echo-config-`);

  process.env.HOME = home;
  process.env.APPDATA = home;
  delete process.env.XDG_CONFIG_HOME;

  try {
    const configPath = getConfigPath();
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, "{ invalid json", "utf-8");

    await assert.rejects(loadConfig(), (error) => {
      assert.equal(error instanceof Error, true);
      assert.match(error.message, /Invalid JSON in config file:/);
      assert.match(error.message, new RegExp(escapeRegExp(configPath)));
      assert.match(error.message, /Fix the JSON syntax or run `commit-echo init` to recreate it\./);
      return true;
    });
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }

    if (originalAppData === undefined) {
      delete process.env.APPDATA;
    } else {
      process.env.APPDATA = originalAppData;
    }

    if (originalXdgConfigHome === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
    }
  }
});
