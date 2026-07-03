import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { platform, tmpdir } from 'node:os';

import { buildProfile, formatProfile } from '../dist/history/store.js';

function configDirFor(homeDir) {
  return platform() === 'darwin'
    ? join(homeDir, 'Library', 'Application Support', 'commit-echo')
    : platform() === 'win32'
      ? join(homeDir, 'AppData', 'Roaming', 'commit-echo')
      : join(homeDir, '.config', 'commit-echo');
}

function writeHistory(homeDir, messages) {
  const configDir = configDirFor(homeDir);
  const historyPath = join(configDir, 'history.jsonl');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    historyPath,
    messages
      .map((message, index) =>
        JSON.stringify({
          timestamp: `2026-05-30T00:00:0${index}Z`,
          message,
          diff: '',
          model: 'test-model',
          provider: 'openai',
        }),
      )
      .join('\n') + '\n',
    'utf-8',
  );
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

test('buildProfile excludes descriptive verb forms from the imperative-rate denominator', async () => {
  const originalHome = process.env.HOME;
  const originalAppData = process.env.APPDATA;
  const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
  const tempHome = mkdtempSync(join(tmpdir(), 'commit-echo-home-'));

  try {
    process.env.HOME = tempHome;
    process.env.APPDATA = join(tempHome, 'AppData', 'Roaming');
    process.env.XDG_CONFIG_HOME = join(tempHome, '.config');
    writeHistory(tempHome, ['fix: add retries', 'fix: added retries', 'fix: adding retries']);

    const profile = await buildProfile(10);

    assert.equal(profile.totalCommits, 3);
    assert.equal(profile.imperativeRate, 1);
  } finally {
    restoreEnv('HOME', originalHome);
    restoreEnv('APPDATA', originalAppData);
    restoreEnv('XDG_CONFIG_HOME', originalXdgConfigHome);
    rmSync(tempHome, { recursive: true, force: true });
  }
});

test('formatProfile reports the empty-history fallback', () => {
  const output = formatProfile({
    avgLength: 0,
    commonPrefixes: [],
    prefixRates: {},
    imperativeRate: 0,
    sentenceCaseRate: 0,
    usesScopeRate: 0,
    usesBodyRate: 0,
    totalCommits: 0,
  });

  assert.equal(output, 'No commit history yet. Suggestions will use default style.');
});

test('formatProfile renders mixed labels when profile rates are zero', () => {
  const output = formatProfile({
    avgLength: 24,
    commonPrefixes: [],
    prefixRates: {},
    imperativeRate: 0,
    sentenceCaseRate: 0,
    usesScopeRate: 0,
    usesBodyRate: 0,
    totalCommits: 2,
  });

  assert.match(output, /Analyzed 2 commit\(s\)/);
  assert.match(output, /Average length: 24 characters/);
  assert.match(output, /Commit tone: Mixed\/descriptive \(0% imperative\)/);
  assert.match(output, /Capitalization: Mixed \(0% capitalized\)/);
  assert.match(output, /Scope usage: 0%/);
  assert.match(output, /Body usage: 0%/);
  assert.match(output, /No conventional commit prefixes detected/);
});

test('formatProfile renders dominant tone, capitalization, scope, body, and prefix rates', () => {
  const output = formatProfile({
    avgLength: 32,
    commonPrefixes: ['fix', 'feat'],
    prefixRates: { fix: 0.75, feat: 0.25 },
    imperativeRate: 0.8,
    sentenceCaseRate: 0.5,
    usesScopeRate: 0.25,
    usesBodyRate: 0.5,
    totalCommits: 4,
  });

  assert.match(output, /Analyzed 4 commit\(s\)/);
  assert.match(output, /Commit tone: Mostly imperative \(80% imperative\)/);
  assert.match(output, /Capitalization: Mostly sentence case \(50% capitalized\)/);
  assert.match(output, /Scope usage: 25%/);
  assert.match(output, /Body usage: 50%/);
  assert.match(output, /Common prefixes: fix: \(75%\), feat: \(25%\)/);
});
