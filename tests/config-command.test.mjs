import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
