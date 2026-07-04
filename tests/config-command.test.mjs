import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { maskApiKey } from '../dist/commands/config.js';
const execFileAsync = promisify(execFile);

/** Resolves the platform-specific commit-echo config directory for an isolated home. */
function configDirFor(homeDir) {
  return platform() === 'darwin'
    ? join(homeDir, 'Library', 'Application Support', 'commit-echo')
    : platform() === 'win32'
      ? join(homeDir, 'AppData', 'Roaming', 'commit-echo')
      : join(homeDir, '.config', 'commit-echo');
}

/** Builds an environment that keeps config reads inside the test home directory. */
function envFor(homeDir) {
  return {
    ...process.env,
    APPDATA: join(homeDir, 'AppData', 'Roaming'),
    FORCE_COLOR: '0',
    HOME: homeDir,
    NO_COLOR: '1',
    XDG_CONFIG_HOME: join(homeDir, '.config'),
  };
}

/** Runs the built config command against an isolated test home. */
async function runConfig(homeDir) {
  return execFileAsync(process.execPath, ['dist/index.js', '--no-color', 'config'], {
    env: envFor(homeDir),
  });
}

/** Runs the built config command with extra arguments against an isolated test home. */
async function runConfigWithArgs(homeDir, args = []) {
  return execFileAsync(process.execPath, ['dist/index.js', '--no-color', 'config', ...args], {
    env: envFor(homeDir),
  });
}

/** Writes a representative config file with optional field overrides. */
function writeConfig(homeDir, overrides = {}) {
  const configDir = configDirFor(homeDir);
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    join(configDir, 'config.json'),
    JSON.stringify(
      {
        apiKey: 'sk-test-secret-value',
        historySize: 12,
        maxDiffSize: 4000,
        model: 'test-model',
        provider: 'openai',
        ...overrides,
      },
      null,
      2,
    ),
    'utf-8',
  );
}

function readConfig(homeDir) {
  return JSON.parse(readFileSync(join(configDirFor(homeDir), 'config.json'), 'utf-8'));
}

/** Creates and removes a temporary home directory around a config command test. */
async function withTempHome(callback) {
  const homeDir = mkdtempSync(join(tmpdir(), 'commit-echo-home-'));

  try {
    return await callback(homeDir);
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
}

test('config command asks users to initialize when no configuration exists', async () => {
  await withTempHome(async (homeDir) => {
    const { stdout, stderr } = await runConfig(homeDir);
    const output = stdout + stderr;

    assert.match(output, /No configuration found/);
    assert.match(output, /commit-echo init/);
  });
});

test('config command displays the current configuration with a masked API key', async () => {
  await withTempHome(async (homeDir) => {
    writeConfig(homeDir);

    const { stdout, stderr } = await runConfig(homeDir);
    const output = stdout + stderr;

    assert.match(output, /Current Configuration/);
    assert.match(output, /Provider:\s+OpenAI/);
    assert.match(output, /Model:\s+test-model/);
    assert.match(output, /Endpoint:\s+https:\/\/api\.openai\.com\/v1/);
    assert.match(output, /History size:\s+12/);
    assert.match(output, /Max diff size:\s+4000/);
    assert.match(output, /API key:\s+sk-t••••/);
    assert.doesNotMatch(output, /sk-test-secret-value/);
  });
});

test('config command displays a custom endpoint from the config file', async () => {
  await withTempHome(async (homeDir) => {
    writeConfig(homeDir, {
      baseUrl: 'https://api.example.test/v1',
      provider: '__custom__',
    });

    const { stdout, stderr } = await runConfig(homeDir);
    const output = stdout + stderr;

    assert.match(output, /Provider:\s+Custom \(OpenAI-compatible\)/);
    assert.match(output, /Endpoint:\s+https:\/\/api\.example\.test\/v1/);
  });
});

test('config command reports when no API key is stored in config', async () => {
  await withTempHome(async (homeDir) => {
    writeConfig(homeDir, { apiKey: undefined });

    const { stdout, stderr } = await runConfig(homeDir);
    const output = stdout + stderr;

    assert.match(output, /API key:\s+not stored in config/);
  });
});

test('maskApiKey returns fallback message for undefined', () => {
  assert.equal(maskApiKey(undefined), 'not stored in config');
});

test('maskApiKey returns fallback message for empty string', () => {
  assert.equal(maskApiKey(''), 'not stored in config');
});

test('maskApiKey masks a 1-character key', () => {
  assert.equal(maskApiKey('a'), 'a••••');
});

test('maskApiKey masks a 2-character key', () => {
  assert.equal(maskApiKey('ab'), 'ab••••');
});

test('maskApiKey masks a 3-character key', () => {
  assert.equal(maskApiKey('abc'), 'abc••••');
});

test('maskApiKey masks a 4-character key', () => {
  assert.equal(maskApiKey('abcd'), 'abcd••••');
});

test('maskApiKey masks a long key', () => {
  assert.equal(maskApiKey('abcdefghijk'), 'abcd••••');
});

test('config --json returns error JSON and exits non-zero when no configuration exists', async () => {
  await withTempHome(async (homeDir) => {
    await assert.rejects(
      () => runConfigWithArgs(homeDir, ['--json']),
      (error) => {
        assert.equal(error.code, 1);
        assert.equal(error.stderr, '');
        const data = JSON.parse(error.stdout);
        assert.deepEqual(data, { error: 'No configuration found. Run commit-echo init first.' });
        return true;
      },
    );
  });
});

test('config --json returns configuration as JSON with masked API key', async () => {
  await withTempHome(async (homeDir) => {
    writeConfig(homeDir);

    const { stdout, stderr } = await runConfigWithArgs(homeDir, ['--json']);
    const data = JSON.parse(stdout);

    assert.equal(stderr, '');
    assert.equal(data.provider, 'OpenAI');
    assert.equal(data.model, 'test-model');
    assert.equal(data.endpoint, 'https://api.openai.com/v1');
    assert.equal(data.historySize, 12);
    assert.equal(data.maxDiffSize, 4000);
    assert.equal(data.apiKey, 'sk-t••••');
    assert.doesNotMatch(stdout, /sk-test-secret-value/);
  });
});

test('config --json returns custom endpoint and provider in JSON', async () => {
  await withTempHome(async (homeDir) => {
    writeConfig(homeDir, {
      baseUrl: 'https://api.example.test/v1',
      provider: '__custom__',
    });

    const { stdout, stderr } = await runConfigWithArgs(homeDir, ['--json']);
    const data = JSON.parse(stdout);

    assert.equal(stderr, '');
    assert.equal(data.provider, 'Custom (OpenAI-compatible)');
    assert.equal(data.endpoint, 'https://api.example.test/v1');
  });
});

test('config --json reports missing API key in JSON', async () => {
  await withTempHome(async (homeDir) => {
    writeConfig(homeDir, { apiKey: undefined });

    const { stdout, stderr } = await runConfigWithArgs(homeDir, ['--json']);
    const data = JSON.parse(stdout);

    assert.equal(stderr, '');
    assert.equal(data.apiKey, 'not stored in config');
  });
});

test('config set updates a string value in the persisted config', async () => {
  await withTempHome(async (homeDir) => {
    writeConfig(homeDir);

    const { stdout, stderr } = await runConfigWithArgs(homeDir, ['set', 'model', 'gpt-4.1-mini']);
    const config = readConfig(homeDir);

    assert.match(stdout + stderr, /Updated model/);
    assert.equal(config.model, 'gpt-4.1-mini');
    assert.equal(config.provider, 'openai');
  });
});

test('config set coerces numeric values before saving', async () => {
  await withTempHome(async (homeDir) => {
    writeConfig(homeDir);

    const { stdout, stderr } = await runConfigWithArgs(homeDir, ['set', 'maxDiffSize', '8000']);
    const config = readConfig(homeDir);

    assert.match(stdout + stderr, /Updated maxDiffSize/);
    assert.equal(config.maxDiffSize, 8000);
  });
});

test('config set rejects unknown keys', async () => {
  await withTempHome(async (homeDir) => {
    writeConfig(homeDir);

    await assert.rejects(
      () => runConfigWithArgs(homeDir, ['set', 'unknownKey', 'value']),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stdout + error.stderr, /Unknown config key: unknownKey/);
        assert.equal(readConfig(homeDir).model, 'test-model');
        return true;
      },
    );
  });
});

test('config set rejects invalid numeric values', async () => {
  await withTempHome(async (homeDir) => {
    writeConfig(homeDir);

    await assert.rejects(
      () => runConfigWithArgs(homeDir, ['set', 'historySize', 'ten']),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stdout + error.stderr, /historySize must be a positive integer/);
        assert.equal(readConfig(homeDir).historySize, 12);
        return true;
      },
    );
  });
});

test('config set rejects unknown provider keys', async () => {
  await withTempHome(async (homeDir) => {
    writeConfig(homeDir);

    await assert.rejects(
      () => runConfigWithArgs(homeDir, ['set', 'provider', 'opneai']),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stdout + error.stderr, /Unknown provider: opneai/);
        assert.equal(readConfig(homeDir).provider, 'openai');
        return true;
      },
    );
  });
});

test('config set rejects invalid base URLs', async () => {
  await withTempHome(async (homeDir) => {
    writeConfig(homeDir);

    await assert.rejects(
      () => runConfigWithArgs(homeDir, ['set', 'baseUrl', 'not-a-url']),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stdout + error.stderr, /baseUrl must be a valid URL/);
        assert.equal(readConfig(homeDir).baseUrl, undefined);
        return true;
      },
    );
  });
});

test('config set normalizes valid base URLs before saving', async () => {
  await withTempHome(async (homeDir) => {
    writeConfig(homeDir);

    await runConfigWithArgs(homeDir, ['set', 'baseUrl', 'https://api.example.test/v1///']);
    const config = readConfig(homeDir);

    assert.equal(config.baseUrl, 'https://api.example.test/v1');
  });
});

test('config set preserves surrounding whitespace for template values', async () => {
  await withTempHome(async (homeDir) => {
    writeConfig(homeDir);

    await runConfigWithArgs(homeDir, ['set', 'systemPromptTemplate', '  keep surrounding whitespace  ']);
    const config = readConfig(homeDir);

    assert.equal(config.systemPromptTemplate, '  keep surrounding whitespace  ');
  });
});

test('config set does not persist environment-only overrides for other keys', async () => {
  await withTempHome(async (homeDir) => {
    writeConfig(homeDir);

    await execFileAsync(process.execPath, ['dist/index.js', '--no-color', 'config', 'set', 'model', 'gpt-4.1-mini'], {
      env: {
        ...envFor(homeDir),
        COMMIT_ECHO_API_KEY: 'sk-env-only-secret',
      },
    });

    const config = readConfig(homeDir);

    assert.equal(config.model, 'gpt-4.1-mini');
    assert.equal(config.apiKey, 'sk-test-secret-value');
  });
});
