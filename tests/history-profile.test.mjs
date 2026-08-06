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

test('buildProfile counts descriptive verb forms in the imperative-rate denominator', async () => {
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
    assert.equal(profile.imperativeRate, 1 / 3);
  } finally {
    restoreEnv('HOME', originalHome);
    restoreEnv('APPDATA', originalAppData);
    restoreEnv('XDG_CONFIG_HOME', originalXdgConfigHome);
    rmSync(tempHome, { recursive: true, force: true });
  }
});

test('buildProfile recognizes base-form verbs that end in descriptive suffixes', async () => {
  const originalHome = process.env.HOME;
  const originalAppData = process.env.APPDATA;
  const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
  const tempHome = mkdtempSync(join(tmpdir(), 'commit-echo-home-'));

  try {
    process.env.HOME = tempHome;
    process.env.APPDATA = join(tempHome, 'AppData', 'Roaming');
    process.env.XDG_CONFIG_HOME = join(tempHome, '.config');
    writeHistory(tempHome, ['fix: add retries', 'fix: Bring retries', 'fix: added retries']);

    const profile = await buildProfile(10);

    assert.equal(profile.totalCommits, 3);
    assert.equal(profile.imperativeRate, 2 / 3);
  } finally {
    restoreEnv('HOME', originalHome);
    restoreEnv('APPDATA', originalAppData);
    restoreEnv('XDG_CONFIG_HOME', originalXdgConfigHome);
    rmSync(tempHome, { recursive: true, force: true });
  }
});

test('buildProfile recognizes prefix-derived base-form verbs as imperative', async () => {
  const originalHome = process.env.HOME;
  const originalAppData = process.env.APPDATA;
  const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
  const tempHome = mkdtempSync(join(tmpdir(), 'commit-echo-home-'));

  try {
    process.env.HOME = tempHome;
    process.env.APPDATA = join(tempHome, 'AppData', 'Roaming');
    process.env.XDG_CONFIG_HOME = join(tempHome, '.config');
    writeHistory(tempHome, ['fix: reseed database', 'fix: preseed retries', 'fix: adding retries']);

    const profile = await buildProfile(10);

    assert.equal(profile.totalCommits, 3);
    assert.equal(profile.imperativeRate, 2 / 3);
  } finally {
    restoreEnv('HOME', originalHome);
    restoreEnv('APPDATA', originalAppData);
    restoreEnv('XDG_CONFIG_HOME', originalXdgConfigHome);
    rmSync(tempHome, { recursive: true, force: true });
  }
});

test('buildProfile recognizes ed-suffix base-form verbs not in the base allowlist', async () => {
  const originalHome = process.env.HOME;
  const originalAppData = process.env.APPDATA;
  const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
  const tempHome = mkdtempSync(join(tmpdir(), 'commit-echo-home-'));

  try {
    process.env.HOME = tempHome;
    process.env.APPDATA = join(tempHome, 'AppData', 'Roaming');
    process.env.XDG_CONFIG_HOME = join(tempHome, '.config');
    writeHistory(tempHome, ['fix: succeed after retry', 'fix: weed stale entries', 'fix: adding retries']);

    const profile = await buildProfile(10);

    assert.equal(profile.totalCommits, 3);
    assert.equal(profile.imperativeRate, 2 / 3);
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

test('buildProfile computes scope-usage ratio', async () => {
  const originalHome = process.env.HOME;
  const originalAppData = process.env.APPDATA;
  const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
  const tempHome = mkdtempSync(join(tmpdir(), 'commit-echo-home-'));

  try {
    process.env.HOME = tempHome;
    process.env.APPDATA = join(tempHome, 'AppData', 'Roaming');
    process.env.XDG_CONFIG_HOME = join(tempHome, '.config');
    writeHistory(tempHome, [
      'feat(auth): add login',
      'fix: resolve crash',
      'docs(readme): update',
      'style: format code'
    ]);

    const profile = await buildProfile(10);

    assert.equal(profile.totalCommits, 4);
    assert.equal(profile.usesScopeRate, 0.5);
  } finally {
    restoreEnv('HOME', originalHome);
    restoreEnv('APPDATA', originalAppData);
    restoreEnv('XDG_CONFIG_HOME', originalXdgConfigHome);
    rmSync(tempHome, { recursive: true, force: true });
  }
});

test('buildProfile computes body-usage ratio', async () => {
  const originalHome = process.env.HOME;
  const originalAppData = process.env.APPDATA;
  const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
  const tempHome = mkdtempSync(join(tmpdir(), 'commit-echo-home-'));

  try {
    process.env.HOME = tempHome;
    process.env.APPDATA = join(tempHome, 'AppData', 'Roaming');
    process.env.XDG_CONFIG_HOME = join(tempHome, '.config');
    writeHistory(tempHome, [
      'feat: no body',
      'fix: with body\n\nThis is a body.',
      'docs: no body',
      'style: with body\n\nBody line 1\nBody line 2'
    ]);

    const profile = await buildProfile(10);

    assert.equal(profile.totalCommits, 4);
    assert.equal(profile.usesBodyRate, 0.5);
  } finally {
    restoreEnv('HOME', originalHome);
    restoreEnv('APPDATA', originalAppData);
    restoreEnv('XDG_CONFIG_HOME', originalXdgConfigHome);
    rmSync(tempHome, { recursive: true, force: true });
  }
});

test('buildProfile handles empty history', async () => {
  const originalHome = process.env.HOME;
  const originalAppData = process.env.APPDATA;
  const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
  const tempHome = mkdtempSync(join(tmpdir(), 'commit-echo-home-'));

  try {
    process.env.HOME = tempHome;
    process.env.APPDATA = join(tempHome, 'AppData', 'Roaming');
    process.env.XDG_CONFIG_HOME = join(tempHome, '.config');
    writeHistory(tempHome, []);

    const profile = await buildProfile(10);

    assert.equal(profile.totalCommits, 0);
    assert.equal(profile.usesScopeRate, 0);
    assert.equal(profile.usesBodyRate, 0);
    assert.equal(profile.imperativeRate, 0);
    assert.equal(profile.sentenceCaseRate, 0);
  } finally {
    restoreEnv('HOME', originalHome);
    restoreEnv('APPDATA', originalAppData);
    restoreEnv('XDG_CONFIG_HOME', originalXdgConfigHome);
    rmSync(tempHome, { recursive: true, force: true });
  }
});
