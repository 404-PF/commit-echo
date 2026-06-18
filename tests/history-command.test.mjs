import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function configDirFor(homeDir) {
  return platform() === 'darwin'
    ? join(homeDir, 'Library', 'Application Support', 'commit-echo')
    : platform() === 'win32'
      ? join(homeDir, 'AppData', 'Roaming', 'commit-echo')
      : join(homeDir, '.config', 'commit-echo');
}

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

async function runHistory(homeDir) {
  return execFileAsync(process.execPath, ['dist/index.js', '--no-color', 'history'], {
    env: envFor(homeDir),
  });
}

function writeConfig(homeDir, overrides = {}) {
  const configDir = configDirFor(homeDir);
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    join(configDir, 'config.json'),
    JSON.stringify(
      {
        historySize: 5,
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

function writeHistory(homeDir, messages) {
  const configDir = configDirFor(homeDir);
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    join(configDir, 'history.jsonl'),
    messages
      .map((message, index) =>
        JSON.stringify({
          diff: '',
          message,
          model: 'test-model',
          provider: 'openai',
          timestamp: `2026-06-0${index + 1}T00:00:00.000Z`,
        }),
      )
      .join('\n') + '\n',
    'utf-8',
  );
}

async function withTempHome(callback) {
  const homeDir = mkdtempSync(join(tmpdir(), 'commit-echo-home-'));

  try {
    return await callback(homeDir);
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
}

test('history command asks users to initialize when no configuration exists', async () => {
  await withTempHome(async (homeDir) => {
    const { stdout, stderr } = await runHistory(homeDir);
    const output = stdout + stderr;

    assert.match(output, /No configuration found/);
    assert.match(output, /commit-echo init/);
  });
});

test('history command reports empty history after configuration exists', async () => {
  await withTempHome(async (homeDir) => {
    writeConfig(homeDir);

    const { stdout, stderr } = await runHistory(homeDir);
    const output = stdout + stderr;

    assert.match(output, /No commit history yet/);
    assert.match(output, /Commit messages will be saved after you accept suggestions/);
  });
});

test('history command renders the style profile and recent commit messages', async () => {
  await withTempHome(async (homeDir) => {
    writeConfig(homeDir);
    writeHistory(homeDir, [
      'fix: keep history output stable',
      'feat: render recent commits\n\nDescribe the rendered state.',
    ]);

    const { stdout, stderr } = await runHistory(homeDir);
    const output = stdout + stderr;
    const firstMessageIndex = output.indexOf('fix: keep history output stable');
    const secondMessageIndex = output.indexOf('feat: render recent commits');

    assert.match(output, /Style Profile/);
    assert.match(output, /Analyzed 2 commit\(s\)/);
    assert.match(output, /Recent Commits/);
    assert.match(output, /Total commits tracked: 2/);
    assert.notEqual(firstMessageIndex, -1);
    assert.notEqual(secondMessageIndex, -1);
    assert.ok(firstMessageIndex < secondMessageIndex);
  });
});
