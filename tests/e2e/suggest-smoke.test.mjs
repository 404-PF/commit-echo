import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function onceExit(child) {
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code, signal) => resolve({ code, signal }));
  });
}

test('suggest smoke test boots the CLI, loads config, and prints suggestions', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'commit-echo-e2e-'));
  const home = join(root, 'home');
  const repo = join(root, 'repo');
  await mkdir(home, { recursive: true });
  await mkdir(repo, { recursive: true });

  execFileSync('git', ['init'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'E2E Tester'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'e2e@example.com'], { cwd: repo });
  await writeFile(join(repo, 'README.md'), '# fixture\n', 'utf8');
  execFileSync('git', ['add', 'README.md'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'feat: initial fixture'], { cwd: repo });
  await writeFile(join(repo, 'README.md'), '# fixture\n\nupdated\n', 'utf8');
  execFileSync('git', ['add', 'README.md'], { cwd: repo });

  const configDir = platform() === 'darwin'
    ? join(home, 'Library', 'Application Support', 'commit-echo')
    : platform() === 'win32'
      ? join(home, 'AppData', 'Roaming', 'commit-echo')
      : join(home, '.config', 'commit-echo');
  await mkdir(configDir, { recursive: true });

  const server = createServer(async (req, res) => {
    if (req.url === '/chat/completions' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        model: 'fixture-model',
        choices: [{ message: { content: '1. feat: add smoke test coverage\n2. docs: refresh quickstart examples' } }],
      }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
  const port = await listen(server);
  t.after(async () => {
    server.close();
    await rm(root, { recursive: true, force: true });
  });

  await writeFile(
    join(configDir, 'config.json'),
    JSON.stringify({
      provider: '__custom__',
      model: 'fixture-model',
      baseUrl: `http://127.0.0.1:${port}`,
      apiKey: 'test-key',
      historySize: 5,
    }, null, 2),
    'utf8'
  );

  const child = spawn('node', [join(process.cwd(), 'dist/index.js'), 'suggest', '--no-commit'], {
    cwd: repo,
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: join(home, '.config'),
      APPDATA: join(home, 'AppData', 'Roaming'),
      FORCE_COLOR: '0',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  let interrupted = false;
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
    if (!interrupted && stdout.includes('feat: add smoke test coverage')) {
      interrupted = true;
      child.kill('SIGINT');
    }
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const result = await onceExit(child);

  assert.match(stdout, /Suggestions generated:/);
  assert.match(stdout, /feat: add smoke test coverage/);
  assert.equal(stderr, '');
  assert.ok(result.code === 0 || result.signal === 'SIGINT');
});
