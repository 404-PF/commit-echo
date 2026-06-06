import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { platform, tmpdir } from 'node:os';
import { join } from 'node:path';

function configDirFor(home) {
  return platform() === 'darwin'
    ? join(home, 'Library', 'Application Support', 'commit-echo')
    : platform() === 'win32'
      ? join(home, 'AppData', 'Roaming', 'commit-echo')
      : join(home, '.config', 'commit-echo');
}

function onceExit(child) {
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code, signal) => resolve({ code, signal }));
  });
}

test('suggest --no-commit prints a deprecation warning', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'commit-echo-no-commit-warning-'));
  const home = join(root, 'home');
  const repo = join(root, 'repo');
  const configDir = configDirFor(home);

  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  await mkdir(configDir, { recursive: true });
  await mkdir(repo, { recursive: true });
  execFileSync('git', ['init'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'E2E Tester'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'e2e@example.com'], { cwd: repo });
  await writeFile(join(repo, 'README.md'), '# fixture\n', 'utf8');
  execFileSync('git', ['add', 'README.md'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'feat: initial fixture'], { cwd: repo });

  await writeFile(
    join(configDir, 'config.json'),
    JSON.stringify({ provider: 'openai', model: 'gpt-4.1', historySize: 5, maxDiffSize: 4000 }, null, 2),
    'utf8',
  );

  const child = spawn(process.execPath, [join(process.cwd(), 'dist/index.js'), 'suggest', '--no-commit'], {
    cwd: repo,
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: join(home, '.config'),
      APPDATA: join(home, 'AppData', 'Roaming'),
      FORCE_COLOR: '0',
      OPENAI_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const result = await onceExit(child);

  assert.equal(result.code, 0);
  assert.match(stderr, /--no-commit is deprecated/);
  assert.match(stdout, /No changes detected/);
});
