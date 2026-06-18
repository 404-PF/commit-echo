import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname } from 'node:path';
import test from 'node:test';

import { getConfigPath, loadConfig } from '../dist/config/store.js';

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function withTempConfig(run) {
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
    await run(configPath);
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

    await rm(home, { recursive: true, force: true });
  }
}

async function writeConfig(configPath, value) {
  await writeFile(configPath, JSON.stringify(value, null, 2), 'utf-8');
}

test('loadConfig reports invalid JSON with the config path and fix hint', async () => {
  await withTempConfig(async (configPath) => {
    await writeFile(configPath, '{ invalid json', 'utf-8');

    await assert.rejects(loadConfig(), (error) => {
      assert.equal(error instanceof Error, true);
      assert.match(error.message, /Invalid JSON in config file:/);
      assert.match(error.message, new RegExp(escapeRegExp(configPath)));
      assert.match(error.message, /Fix the JSON syntax or run `commit-echo init` to recreate it\./);
      return true;
    });
  });
});

test('loadConfig defaults missing size values', async () => {
  await withTempConfig(async (configPath) => {
    await writeConfig(configPath, {
      provider: 'openai',
      model: 'gpt-4.1',
    });

    const config = await loadConfig();

    assert.equal(config.historySize, 50);
    assert.equal(config.maxDiffSize, 4000);
  });
});

test('loadConfig preserves valid size values', async () => {
  await withTempConfig(async (configPath) => {
    await writeConfig(configPath, {
      provider: 'openai',
      model: 'gpt-4.1',
      historySize: 12,
      maxDiffSize: 8000,
    });

    const config = await loadConfig();

    assert.equal(config.historySize, 12);
    assert.equal(config.maxDiffSize, 8000);
  });
});

test('loadConfig rejects invalid size values', async () => {
  const invalidCases = [
    ['historySize', 0],
    ['historySize', -1],
    ['historySize', 1.5],
    ['historySize', '5'],
    ['maxDiffSize', 0],
    ['maxDiffSize', -1],
    ['maxDiffSize', 1.5],
    ['maxDiffSize', '4000'],
  ];

  for (const [field, value] of invalidCases) {
    await withTempConfig(async (configPath) => {
      await writeConfig(configPath, {
        provider: 'openai',
        model: 'gpt-4.1',
        historySize: 50,
        maxDiffSize: 4000,
        [field]: value,
      });

      await assert.rejects(loadConfig(), (error) => {
        assert.equal(error instanceof Error, true);
        assert.match(error.message, new RegExp(`Invalid ${field} in config file:`));
        assert.match(error.message, new RegExp(escapeRegExp(configPath)));
        assert.match(error.message, /Expected a positive integer\./);
        return true;
      });
    });
  }
});
