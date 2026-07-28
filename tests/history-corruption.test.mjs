import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { getConfigDir } from '../dist/config/store.js';
import { countEntries, loadEntries } from '../dist/history/store.js';

function writeHistory(lines) {
  const configDir = getConfigDir();
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'history.jsonl'), `${lines.join('\n')}\n`, 'utf-8');
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function validEntry(message, timestamp) {
  return JSON.stringify({
    timestamp,
    message,
    diff: '',
    model: 'test-model',
    provider: 'local',
  });
}

async function withIsolatedHistory(lines, assertion) {
  const originalHome = process.env.HOME;
  const originalAppData = process.env.APPDATA;
  const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
  const tempHome = mkdtempSync(join(tmpdir(), 'commit-echo-history-'));
  const warnings = [];
  const originalWarn = console.warn;

  try {
    process.env.HOME = tempHome;
    process.env.APPDATA = join(tempHome, 'AppData', 'Roaming');
    process.env.XDG_CONFIG_HOME = join(tempHome, '.config');
    console.warn = (message) => warnings.push(String(message));

    writeHistory(lines);
    await assertion({ warnings });
  } finally {
    console.warn = originalWarn;
    restoreEnv('HOME', originalHome);
    restoreEnv('APPDATA', originalAppData);
    restoreEnv('XDG_CONFIG_HOME', originalXdgConfigHome);
    rmSync(tempHome, { recursive: true, force: true });
  }
}

test('loadEntries warns about corrupted history lines and keeps valid entries', async () => {
  await withIsolatedHistory(
    [
      validEntry('fix: keep first valid entry', '2026-06-01T00:00:00Z'),
      '{not valid json',
      validEntry('feat: keep latest valid entry', '2026-06-01T00:00:01Z'),
    ],
    async ({ warnings }) => {
      const entries = await loadEntries(2);

      assert.deepEqual(
        entries.map((entry) => entry.message),
        ['feat: keep latest valid entry', 'fix: keep first valid entry'],
      );
      assert.equal(warnings.length, 1);
      assert.match(warnings[0], /ignored 1 corrupted commit history entry/);
      assert.match(warnings[0], /line 2/);
    },
  );
});

test('loadEntries warns about multiple corrupted lines', async () => {
  await withIsolatedHistory(
    [
      validEntry('fix: keep first valid entry', '2026-06-01T00:00:00Z'),
      '{invalid line 1',
      '{invalid line 2',
      validEntry('feat: keep latest valid entry', '2026-06-01T00:00:01Z'),
    ],
    async ({ warnings }) => {
      const entries = await loadEntries(10);

      assert.deepEqual(
        entries.map((entry) => entry.message),
        ['feat: keep latest valid entry', 'fix: keep first valid entry'],
      );
      assert.equal(warnings.length, 1);
      assert.match(warnings[0], /ignored 2 corrupted commit history entries/);
      assert.match(warnings[0], /line 2, 3/);
    },
  );
});

test('loadEntries truncates long corrupted line lists', async () => {
  await withIsolatedHistory(
    [
      validEntry('fix: keep oldest valid entry', '2026-06-01T00:00:00Z'),
      '{invalid line 2',
      '{invalid line 3',
      '{invalid line 4',
      '{invalid line 5',
      '{invalid line 6',
      '{invalid line 7',
      '{invalid line 8',
      validEntry('feat: keep newest valid entry', '2026-06-01T00:00:01Z'),
    ],
    async ({ warnings }) => {
      const entries = await loadEntries(10);

      assert.deepEqual(
        entries.map((entry) => entry.message),
        ['feat: keep newest valid entry', 'fix: keep oldest valid entry'],
      );
      assert.equal(warnings.length, 1);
      assert.match(warnings[0], /ignored 7 corrupted commit history entries/);
      assert.match(warnings[0], /\+2 more/);
    },
  );
});

test('loadEntries warns and returns empty entries when all lines are corrupted', async () => {
  await withIsolatedHistory(['{invalid line 1', '{invalid line 2'], async ({ warnings }) => {
    const entries = await loadEntries(10);

    assert.deepEqual(entries, []);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /ignored 2 corrupted commit history entries/);
    assert.match(warnings[0], /line 1, 2/);
  });
});

test('loadEntries stops parsing once it has enough recent valid entries', async () => {
  await withIsolatedHistory(
    [
      '{invalid old line',
      validEntry('fix: keep older valid entry', '2026-06-01T00:00:00Z'),
      validEntry('feat: keep newest valid entry', '2026-06-01T00:00:01Z'),
    ],
    async ({ warnings }) => {
      const entries = await loadEntries(1);

      assert.deepEqual(entries.map((entry) => entry.message), ['feat: keep newest valid entry']);
      assert.deepEqual(warnings, []);
    },
  );
});

test('loadEntries uses a generic location for corrupted rows in a partial scan', async () => {
  const olderEntries = Array.from({ length: 700 }, (_, index) =>
    validEntry(`chore: keep older entry ${index}`, `2026-06-01T00:00:${String(index).padStart(2, '0')}Z`),
  );

  await withIsolatedHistory(
    [...olderEntries, validEntry('fix: keep newest valid entry', '2026-06-01T00:01:00Z'), '{invalid newest line'],
    async ({ warnings }) => {
      const entries = await loadEntries(1);

      assert.deepEqual(entries.map((entry) => entry.message), ['fix: keep newest valid entry']);
      assert.equal(warnings.length, 1);
      assert.match(warnings[0], /ignored 1 corrupted commit history entry/);
      assert.match(warnings[0], /recently scanned rows/);
    },
  );
});

test('countEntries counts raw non-empty history rows, including malformed JSON lines', async () => {
  await withIsolatedHistory(
    [
      validEntry('fix: keep first valid entry', '2026-06-01T00:00:00Z'),
      '',
      '{invalid line',
      validEntry('feat: keep latest valid entry', '2026-06-01T00:00:01Z'),
    ],
    async () => {
      // countEntries reports stored JSONL rows; parsing validity is handled by loadEntries.
      assert.equal(await countEntries(), 3);
    },
  );
});

test('loadEntries preserves UTF-8 characters split across backward-read chunks', async () => {
  const prefix = '{"timestamp":"2026-06-01T00:00:00Z","message":"a';
  const suffix = '","diff":"","model":"test-model","provider":"local"}';
  const messageTailLength = 2 * 1024 * 1024 - Buffer.byteLength(suffix) - 1;
  const row = `${prefix}\u00e9x\u00e9${'b'.repeat(messageTailLength)}${suffix}`;

  const originalConcat = Buffer.concat;
  let concatCalls = 0;
  Buffer.concat = (...args) => {
    concatCalls += 1;
    return originalConcat(...args);
  };

  await withIsolatedHistory([row], async () => {
    try {
      const entries = await loadEntries(1);

      assert.equal(entries.length, 1);
      assert.equal(entries[0].message, `a\u00e9x\u00e9${'b'.repeat(messageTailLength)}`);
      assert.doesNotMatch(entries[0].message, /\uFFFD/);
    } finally {
      Buffer.concat = originalConcat;
    }
  });

  assert.equal(concatCalls, 1);
});
