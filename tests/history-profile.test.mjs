import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { buildProfile } from '../dist/history/store.js';

function writeHistory(homeDir, messages) {
  const configDir = join(homeDir, 'Library', 'Application Support', 'commit-echo');
  const historyPath = join(configDir, 'history.jsonl');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    historyPath,
    messages.map((message, index) => JSON.stringify({
      timestamp: `2026-05-30T00:00:0${index}Z`,
      message,
      diff: '',
      model: 'test-model',
      provider: 'openai',
    })).join('\n') + '\n',
    'utf-8'
  );
}

test('buildProfile excludes descriptive verb forms from the imperative-rate denominator', async () => {
  const originalHome = process.env.HOME;
  const tempHome = mkdtempSync(join(tmpdir(), 'commit-echo-home-'));

  try {
    process.env.HOME = tempHome;
    writeHistory(tempHome, [
      'fix: add retries',
      'fix: added retries',
      'fix: adding retries',
    ]);

    const profile = await buildProfile(10);

    assert.equal(profile.totalCommits, 3);
    assert.equal(profile.imperativeRate, 1);
  } finally {
    process.env.HOME = originalHome;
    rmSync(tempHome, { recursive: true, force: true });
  }
});
