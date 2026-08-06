import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile, stat, chmod } from 'node:fs/promises';
import { tmpdir, platform } from 'node:os';
import { dirname } from 'node:path';
import test from 'node:test';

import { getConfigPath, getConfigDir, loadConfig, saveConfig, invalidateConfigCache, CONFIG_ENV_VARS } from '../dist/config/store.js';

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function withTempConfig(run, envOverrides = {}) {
  const originalHome = process.env.HOME;
  const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
  const originalAppData = process.env.APPDATA;
  const originalEnvVars = {};
  for (const key of CONFIG_ENV_VARS) {
    originalEnvVars[key] = process.env[key];
  }

  const home = await mkdtemp(`${tmpdir()}/commit-echo-config-`);

  process.env.HOME = home;
  process.env.APPDATA = home;
  delete process.env.XDG_CONFIG_HOME;

  for (const [key, value] of Object.entries(envOverrides)) {
    process.env[key] = value;
  }

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

    for (const key of CONFIG_ENV_VARS) {
      if (originalEnvVars[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnvVars[key];
      }
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

// --- Environment variable override tests ---

test('env vars override config file values for string options', async () => {
  await withTempConfig(async (configPath) => {
    await writeConfig(configPath, {
      provider: 'openai',
      model: 'gpt-4.1',
      baseUrl: 'https://api.openai.com',
      apiKey: 'file-api-key',
    });

    const config = await loadConfig();

    assert.equal(config.provider, 'anthropic');
    assert.equal(config.model, 'claude-sonnet-4-20250514');
    assert.equal(config.baseUrl, 'https://custom.api.com');
    assert.equal(config.apiKey, 'env-api-key-123');
  }, {
    COMMIT_ECHO_PROVIDER: 'anthropic',
    COMMIT_ECHO_MODEL: 'claude-sonnet-4-20250514',
    COMMIT_ECHO_BASE_URL: 'https://custom.api.com',
    COMMIT_ECHO_API_KEY: 'env-api-key-123',
  });
});

test('env vars override config file values for numeric options', async () => {
  await withTempConfig(async (configPath) => {
    await writeConfig(configPath, {
      provider: 'openai',
      model: 'gpt-4.1',
      historySize: 12,
      maxDiffSize: 8000,
    });

    const config = await loadConfig();

    assert.equal(config.historySize, 99);
    assert.equal(config.maxDiffSize, 100000);
  }, {
    COMMIT_ECHO_HISTORY_SIZE: '99',
    COMMIT_ECHO_MAX_DIFF_SIZE: '100000',
  });
});

test('env vars fall back to config file values when unset', async () => {
  await withTempConfig(async (configPath) => {
    await writeConfig(configPath, {
      provider: 'openai',
      model: 'gpt-4.1',
      historySize: 25,
      maxDiffSize: 6000,
    });

    const config = await loadConfig();

    assert.equal(config.provider, 'openai');
    assert.equal(config.model, 'gpt-4.1');
    assert.equal(config.historySize, 25);
    assert.equal(config.maxDiffSize, 6000);
  });
});

test('env vars fall back to defaults when neither env var nor config file provides value', async () => {
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

// --- In-memory caching tests ---

test('loadConfig caches the parsed config for the process lifetime', async () => {
  await withTempConfig(async (configPath) => {
    await writeConfig(configPath, {
      provider: 'openai',
      model: 'gpt-4.1',
    });

    const first = await loadConfig();
    // Mutate the underlying file; a second load must still return the cached object.
    await writeConfig(configPath, {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
    });

    const second = await loadConfig();

    assert.equal(second.provider, 'openai');
    assert.equal(second.model, 'gpt-4.1');
    assert.equal(first, second, 'expected the same cached instance');
  });
});

test('invalidateConfigCache forces a fresh read from disk', async () => {
  await withTempConfig(async (configPath) => {
    await writeConfig(configPath, {
      provider: 'openai',
      model: 'gpt-4.1',
    });

    const first = await loadConfig();

    await writeConfig(configPath, {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
    });
    invalidateConfigCache(configPath);

    const second = await loadConfig();

    assert.notEqual(first, second);
    assert.equal(second.provider, 'anthropic');
    assert.equal(second.model, 'claude-sonnet-4-20250514');
  });
});

test('saveConfig invalidates the cache so subsequent loads read new values', async () => {
  await withTempConfig(async (configPath) => {
    await writeConfig(configPath, {
      provider: 'openai',
      model: 'gpt-4.1',
    });

    await loadConfig();

    await saveConfig({
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      historySize: 50,
      maxDiffSize: 4000,
    });

    const after = await loadConfig();

    assert.equal(after.provider, 'anthropic');
    assert.equal(after.model, 'claude-sonnet-4-20250514');
  });
});

test('invalid COMMIT_ECHO_HISTORY_SIZE env var throws', async () => {
  await withTempConfig(async (configPath) => {
    await writeConfig(configPath, {
      provider: 'openai',
      model: 'gpt-4.1',
    });

    await assert.rejects(loadConfig(), (error) => {
      assert.equal(error instanceof Error, true);
      assert.match(error.message, /COMMIT_ECHO_HISTORY_SIZE/);
      assert.match(error.message, /Expected a positive integer/);
      return true;
    });
  }, {
    COMMIT_ECHO_HISTORY_SIZE: 'abc',
  });
});

test('invalid COMMIT_ECHO_MAX_DIFF_SIZE env var throws', async () => {
  await withTempConfig(async (configPath) => {
    await writeConfig(configPath, {
      provider: 'openai',
      model: 'gpt-4.1',
    });

    await assert.rejects(loadConfig(), (error) => {
      assert.equal(error instanceof Error, true);
      assert.match(error.message, /COMMIT_ECHO_MAX_DIFF_SIZE/);
      assert.match(error.message, /Expected a positive integer/);
      return true;
    });
  }, {
    COMMIT_ECHO_MAX_DIFF_SIZE: '-5',
  });
});

test('env var zero for numeric option throws', async () => {
  await withTempConfig(async (configPath) => {
    await writeConfig(configPath, {
      provider: 'openai',
      model: 'gpt-4.1',
    });

    await assert.rejects(loadConfig(), (error) => {
      assert.equal(error instanceof Error, true);
      assert.match(error.message, /COMMIT_ECHO_HISTORY_SIZE/);
      return true;
    });
  }, {
    COMMIT_ECHO_HISTORY_SIZE: '0',
  });
});

// --- templatePath tests ---

test('loadConfig reads templatePath from config file', async () => {
  await withTempConfig(async () => {
    const config = {
      provider: 'openai',
      model: 'gpt-4.1',
      templatePath: '/path/to/template.md',
    };

    await saveConfig(config);
    const loaded = await loadConfig();

    assert.equal(loaded.templatePath, '/path/to/template.md');
  });
});

test('loadConfig templatePath defaults to undefined', async () => {
  await withTempConfig(async () => {
    await writeConfig(getConfigPath(), {
      provider: 'openai',
      model: 'gpt-4.1',
    });

    const loaded = await loadConfig();

    assert.equal(loaded.templatePath, undefined);
  });
});

test('COMMIT_ECHO_TEMPLATE_PATH env var overrides config file', async () => {
  await withTempConfig(async () => {
    await writeConfig(getConfigPath(), {
      provider: 'openai',
      model: 'gpt-4.1',
      templatePath: '/from/config.md',
    });

    const loaded = await loadConfig();

    assert.equal(loaded.templatePath, '/from/env.md');
  }, {
    COMMIT_ECHO_TEMPLATE_PATH: '/from/env.md',
  });
});

test('COMMIT_ECHO_TEMPLATE_PATH env var trims whitespace', async () => {
  await withTempConfig(async () => {
    await writeConfig(getConfigPath(), {
      provider: 'openai',
      model: 'gpt-4.1',
    });

    const loaded = await loadConfig();

    assert.equal(loaded.templatePath, '/trimmed/path.md');
  }, {
    COMMIT_ECHO_TEMPLATE_PATH: '  /trimmed/path.md  ',
  });
});

test('empty COMMIT_ECHO_TEMPLATE_PATH env var results in undefined', async () => {
  await withTempConfig(async () => {
    await writeConfig(getConfigPath(), {
      provider: 'openai',
      model: 'gpt-4.1',
    });

    const loaded = await loadConfig();

    assert.equal(loaded.templatePath, undefined);
  }, {
    COMMIT_ECHO_TEMPLATE_PATH: '  ',
  });
});

// --- saveConfig permission tests (Unix only) ---

const isWindows = platform() === 'win32';

test('saveConfig creates config file with correct content', async () => {
  await withTempConfig(async () => {
    const config = {
      provider: 'openai',
      model: 'gpt-4.1',
      historySize: 50,
      maxDiffSize: 4000,
    };

    await saveConfig(config);
    const loaded = await loadConfig();

    assert.equal(loaded.provider, 'openai');
    assert.equal(loaded.model, 'gpt-4.1');
    assert.equal(loaded.historySize, 50);
    assert.equal(loaded.maxDiffSize, 4000);
  });
});

if (!isWindows) {
  test('saveConfig sets restrictive file permissions (0o600)', async () => {
    await withTempConfig(async () => {
      const config = {
        provider: 'openai',
        model: 'gpt-4.1',
        historySize: 50,
        maxDiffSize: 4000,
      };

      await saveConfig(config);
      const fileStat = await stat(getConfigPath());
      const fileMode = fileStat.mode & 0o777;

      assert.equal(fileMode, 0o600, `Expected 0o600 but got 0o${fileMode.toString(8)}`);
    });
  });

  test('saveConfig sets restrictive directory permissions (0o700)', async () => {
    await withTempConfig(async () => {
      const config = {
        provider: 'openai',
        model: 'gpt-4.1',
        historySize: 50,
        maxDiffSize: 4000,
      };

      await saveConfig(config);
      const dirStat = await stat(getConfigDir());
      const dirMode = dirStat.mode & 0o777;

      assert.equal(dirMode, 0o700, `Expected 0o700 but got 0o${dirMode.toString(8)}`);
    });
  });

  test('loadConfig migrates permissions on pre-existing lax config', async () => {
    await withTempConfig(async () => {
      // Pre-create directory with lax permissions
      await mkdir(getConfigDir(), { recursive: true, mode: 0o777 });
      // Pre-create file with lax permissions (as an older release would)
      await writeFile(getConfigPath(), '{}', 'utf-8');
      await chmod(getConfigPath(), 0o644);

      await loadConfig();

      const dirStat = await stat(getConfigDir());
      const dirMode = dirStat.mode & 0o777;
      const fileStat = await stat(getConfigPath());
      const fileMode = fileStat.mode & 0o777;

      assert.equal(dirMode, 0o700, `Expected dir 0o700 but got 0o${dirMode.toString(8)}`);
      assert.equal(fileMode, 0o600, `Expected file 0o600 but got 0o${fileMode.toString(8)}`);
    });
  });

  test('saveConfig tightens permissions on pre-existing directory and file', async () => {
    await withTempConfig(async () => {
      const config = {
        provider: 'openai',
        model: 'gpt-4.1',
        historySize: 50,
        maxDiffSize: 4000,
      };

      // Pre-create directory with lax permissions
      await mkdir(getConfigDir(), { recursive: true, mode: 0o777 });
      // Pre-create file with lax permissions
      await writeFile(getConfigPath(), '{}', 'utf-8');
      await chmod(getConfigPath(), 0o644);

      await saveConfig(config);

      const dirStat = await stat(getConfigDir());
      const dirMode = dirStat.mode & 0o777;
      const fileStat = await stat(getConfigPath());
      const fileMode = fileStat.mode & 0o777;

      assert.equal(dirMode, 0o700, `Expected dir 0o700 but got 0o${dirMode.toString(8)}`);
      assert.equal(fileMode, 0o600, `Expected file 0o600 but got 0o${fileMode.toString(8)}`);
    });
  });
}
