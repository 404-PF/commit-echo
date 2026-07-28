import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, unlink, utimes, writeFile } from 'node:fs/promises';
import { platform, tmpdir } from 'node:os';
import { join } from 'node:path';

import { appendEntry } from '../dist/history/store.js';

function configDirFor(home) {
  return platform() === 'darwin'
    ? join(home, 'Library', 'Application Support', 'commit-echo')
    : platform() === 'win32'
      ? join(home, 'AppData', 'Roaming', 'commit-echo')
      : join(home, '.config', 'commit-echo');
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

test('appendEntry waits for an existing history lock before appending', async () => {
  const originalHome = process.env.HOME;
  const originalAppData = process.env.APPDATA;
  const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
  const home = await mkdtemp(join(tmpdir(), 'commit-echo-history-lock-'));

  try {
    process.env.HOME = home;
    process.env.APPDATA = join(home, 'AppData', 'Roaming');
    process.env.XDG_CONFIG_HOME = join(home, '.config');

    const configDir = configDirFor(home);
    const historyPath = join(configDir, 'history.jsonl');
    const lockPath = `${historyPath}.lock`;
    await mkdir(configDir, { recursive: true });
    await writeFile(lockPath, '', { flag: 'wx' });

    const entry = {
      timestamp: '2026-07-01T00:00:00.000Z',
      message: 'fix: serialize history writes',
      diff: '',
      model: 'test-model',
      provider: 'test-provider',
    };
    const appendPromise = appendEntry(entry);

    await delay(75);
    const historyBeforeUnlock = await readFile(historyPath, 'utf-8').catch((error) => {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return '';
      throw error;
    });
    assert.equal(historyBeforeUnlock, '');

    await unlink(lockPath);
    await appendPromise;

    const entries = (await readFile(historyPath, 'utf-8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.deepEqual(entries, [entry]);
  } finally {
    restoreEnv('HOME', originalHome);
    restoreEnv('APPDATA', originalAppData);
    restoreEnv('XDG_CONFIG_HOME', originalXdgConfigHome);
    await rm(home, { recursive: true, force: true });
  }
});

test('appendEntry serializes concurrent writes when taking over a stale lock', async () => {
  const originalHome = process.env.HOME;
  const originalAppData = process.env.APPDATA;
  const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
  const home = await mkdtemp(join(tmpdir(), 'commit-echo-history-stale-lock-'));

  try {
    process.env.HOME = home;
    process.env.APPDATA = join(home, 'AppData', 'Roaming');
    process.env.XDG_CONFIG_HOME = join(home, '.config');

    const configDir = configDirFor(home);
    const historyPath = join(configDir, 'history.jsonl');
    const lockPath = `${historyPath}.lock`;
    await mkdir(configDir, { recursive: true });
    await writeFile(lockPath, 'stale-owner', { flag: 'wx' });
    const staleTime = new Date(Date.now() - 2 * 60 * 1000);
    await utimes(lockPath, staleTime, staleTime);

    const entries = Array.from({ length: 8 }, (_, index) => ({
      timestamp: `2026-07-01T00:00:0${index}.000Z`,
      message: `fix: serialize concurrent entry ${index}`,
      diff: '',
      model: 'test-model',
      provider: 'test-provider',
    }));

    await Promise.all(entries.map((entry) => appendEntry(entry)));

    const lines = (await readFile(historyPath, 'utf-8')).trim().split('\n');
    assert.equal(lines.length, entries.length);
    assert.deepEqual(
      lines.map((line) => JSON.parse(line)).sort((a, b) => a.message.localeCompare(b.message)),
      entries.sort((a, b) => a.message.localeCompare(b.message)),
    );
  } finally {
    restoreEnv('HOME', originalHome);
    restoreEnv('APPDATA', originalAppData);
    restoreEnv('XDG_CONFIG_HOME', originalXdgConfigHome);
    await rm(home, { recursive: true, force: true });
  }
});
