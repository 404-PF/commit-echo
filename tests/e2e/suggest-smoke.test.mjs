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

function runSuggestUntil(args, { cwd, env, text }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(process.cwd(), 'dist/index.js'), ...args], {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      child.kill('SIGINT');
      reject(new Error(`Timed out waiting for ${text}. stdout: ${stdout} stderr: ${stderr}`));
    }, 5000);
    child.stdout.on('data', async (chunk) => {
      stdout += chunk.toString();
      if (!settled && stdout.includes(text)) {
        settled = true;
        clearTimeout(timeout);
        child.kill('SIGINT');
        try {
          await onceExit(child);
          resolve({ stdout, stderr });
        } catch (err) {
          reject(err);
        }
      }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (err) => {
      settled = true;
      clearTimeout(timeout);
      reject(err);
    });
    child.on('exit', (code, signal) => {
      if (!settled && !stdout.includes(text)) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`Exited before ${text}. code: ${code} signal: ${signal} stdout: ${stdout} stderr: ${stderr}`));
      }
    });
  });
}

function configDirFor(home) {
  return platform() === 'darwin'
    ? join(home, 'Library', 'Application Support', 'commit-echo')
    : platform() === 'win32'
      ? join(home, 'AppData', 'Roaming', 'commit-echo')
      : join(home, '.config', 'commit-echo');
}

async function setupRepo(root) {
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

  const configDir = configDirFor(home);
  await mkdir(configDir, { recursive: true });

  return { home, repo, configDir };
}

test('suggest smoke test boots the CLI, loads config, and prints suggestions', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'commit-echo-e2e-'));
  const { home, repo, configDir } = await setupRepo(root);

  const requests = [];
  const server = createServer(async (req, res) => {
    if (req.url === '/chat/completions' && req.method === 'POST') {
      let body = '';
      req.setEncoding('utf8');
      for await (const chunk of req) body += chunk;
      const parsed = JSON.parse(body);
      requests.push(parsed);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        model: parsed.model,
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

  await writeFile(
    join(configDir, 'history.jsonl'),
    JSON.stringify({ timestamp: new Date().toISOString(), message: 'feat: add fixture history', diff: '', model: 'fixture-model', provider: '__custom__' }) + '\n',
    'utf8'
  );

  const child = spawn('node', [join(process.cwd(), 'dist/index.js'), 'suggest'], {
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
  assert.equal(requests.at(-1).model, 'fixture-model');
  assert.doesNotMatch(stdout, /Style profile:/);
  assert.doesNotMatch(stdout, /Analyzed 1 commit/);
  assert.equal(stderr, '');
  assert.ok(result.code === 0 || result.signal === 'SIGINT');
});

test('suggest reports no changes before checking for an API key', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'commit-echo-no-changes-'));
  const { home, repo, configDir } = await setupRepo(root);

  execFileSync('git', ['add', 'README.md'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'feat: settle fixture'], { cwd: repo });

  await writeFile(
    join(configDir, 'config.json'),
    JSON.stringify({
      provider: 'openai',
      model: 'gpt-4.1',
      historySize: 5,
      maxDiffSize: 4000,
    }, null, 2),
    'utf8'
  );

  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const child = spawn(process.execPath, [join(process.cwd(), 'dist/index.js'), 'suggest'], {
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
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  const result = await onceExit(child);

  assert.ok(result.code === 0 || result.signal === null);
  assert.equal(stderr, '');
  assert.match(stdout, /No changes detected/);
  assert.doesNotMatch(stdout, /No API key found/);
});

test('suggest --model overrides configured model for one invocation and -m is an alias', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'commit-echo-model-'));
  const { home, repo, configDir } = await setupRepo(root);

  const requests = [];
  const server = createServer(async (req, res) => {
    if (req.url === '/chat/completions' && req.method === 'POST') {
      let body = '';
      req.setEncoding('utf8');
      for await (const chunk of req) body += chunk;
      const parsed = JSON.parse(body);
      requests.push(parsed);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        model: parsed.model,
        choices: [{ message: { content: '1. feat: add override flag\n2. test: cover model alias' } }],
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
      model: 'configured-model',
      baseUrl: `http://127.0.0.1:${port}`,
      apiKey: 'test-key',
      historySize: 5,
    }, null, 2),
    'utf8'
  );

  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    APPDATA: join(home, 'AppData', 'Roaming'),
    FORCE_COLOR: '0',
  };

  const longFlag = await runSuggestUntil(['suggest', '--yes', '--verbose', '--model', 'gpt-4o'], { cwd: repo, env, text: 'Model: gpt-4o' });
  assert.equal(requests.at(-1).model, 'gpt-4o');
  assert.match(longFlag.stdout, /Model: gpt-4o/);

  await runSuggestUntil(['suggest', '-m', 'claude-3-5-sonnet'], { cwd: repo, env, text: 'Suggestions generated:' });
  assert.equal(requests.at(-1).model, 'claude-3-5-sonnet');
});

test('suggest --stream prints incremental SSE output', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'commit-echo-e2e-stream-'));
  const { home, repo, configDir } = await setupRepo(root);

  const requests = [];
  const server = createServer(async (req, res) => {
    if (req.url === '/chat/completions' && req.method === 'POST') {
      let body = '';
      req.setEncoding('utf8');
      for await (const chunk of req) body += chunk;
      const parsed = JSON.parse(body);
      requests.push(parsed);

      if (parsed.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write('data: {"choices":[{"delta":{"content":"1. feat: streamed suggestion"}}]}\n\n');
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        model: parsed.model,
        choices: [{ message: { content: '1. feat: fallback suggestion' } }],
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

  const { stdout } = await runSuggestUntil(
    ['suggest', '--stream'],
    {
      cwd: repo,
      env: {
        ...process.env,
        HOME: home,
        XDG_CONFIG_HOME: join(home, '.config'),
        APPDATA: join(home, 'AppData', 'Roaming'),
        FORCE_COLOR: '0',
      },
      text: 'feat: streamed suggestion',
    },
  );

  assert.match(stdout, /Streaming suggestions/);
  assert.match(stdout, /feat: streamed suggestion/);
  assert.equal(requests.at(-1)?.stream, true);
  assert.equal(
    (stdout.match(/feat: streamed suggestion/g) ?? []).length,
    1,
    'streamed suggestion text should not be printed twice',
  );
});

test('suggest --stream prints incremental Anthropic SSE output', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'commit-echo-e2e-stream-anthropic-'));
  const { home, repo, configDir } = await setupRepo(root);

  const requests = [];
  const server = createServer(async (req, res) => {
    if (req.url === '/v1/messages' && req.method === 'POST') {
      let body = '';
      req.setEncoding('utf8');
      for await (const chunk of req) body += chunk;
      const parsed = JSON.parse(body);
      requests.push(parsed);

      if (parsed.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write('event: content_block_delta\n');
        res.write('data: {"delta":{"text":"1. feat: anthropic streamed suggestion"}}\n\n');
        res.write('event: message_stop\n');
        res.write('data: {}\n\n');
        res.end();
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        model: parsed.model,
        content: [{ type: 'text', text: '1. feat: anthropic fallback suggestion' }],
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
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: 'test-key',
      historySize: 5,
    }, null, 2),
    'utf8'
  );

  const { stdout } = await runSuggestUntil(
    ['suggest', '--stream'],
    {
      cwd: repo,
      env: {
        ...process.env,
        HOME: home,
        XDG_CONFIG_HOME: join(home, '.config'),
        APPDATA: join(home, 'AppData', 'Roaming'),
        FORCE_COLOR: '0',
      },
      text: 'feat: anthropic streamed suggestion',
    },
  );

  assert.match(stdout, /Streaming suggestions/);
  assert.match(stdout, /feat: anthropic streamed suggestion/);
  assert.equal(requests.at(-1)?.stream, true);
});

test('suggest --stream --yes streams output and auto-commits the first suggestion', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'commit-echo-e2e-stream-yes-'));
  const { home, repo, configDir } = await setupRepo(root);

  const requests = [];
  const server = createServer(async (req, res) => {
    if (req.url === '/chat/completions' && req.method === 'POST') {
      let body = '';
      req.setEncoding('utf8');
      for await (const chunk of req) body += chunk;
      const parsed = JSON.parse(body);
      requests.push(parsed);

      if (parsed.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write('data: {"choices":[{"delta":{"content":"1. feat: stream auto commit"}}]}\n\n');
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        model: parsed.model,
        choices: [{ message: { content: '1. feat: fallback suggestion' } }],
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

  const child = spawn(process.execPath, [join(process.cwd(), 'dist/index.js'), 'suggest', '--stream', '--yes'], {
    cwd: repo,
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: join(home, '.config'),
      APPDATA: join(home, 'AppData', 'Roaming'),
      FORCE_COLOR: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });

  const result = await onceExit(child);
  assert.equal(result.code, 0);
  assert.match(stdout, /Streaming suggestions/);
  assert.match(stdout, /feat: stream auto commit/);
  assert.match(stdout, /Selected:/);
  assert.doesNotMatch(stdout, /Choose an action/);
  assert.equal(requests.at(-1)?.stream, true);
});

test('suggest --stream fails fast for unsupported providers', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'commit-echo-e2e-stream-cohere-'));
  const { home, repo, configDir } = await setupRepo(root);

  await writeFile(
    join(configDir, 'config.json'),
    JSON.stringify({
      provider: 'cohere',
      model: 'command-r',
      apiKey: 'test-key',
      historySize: 5,
    }, null, 2),
    'utf8'
  );

  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const child = spawn(process.execPath, [join(process.cwd(), 'dist/index.js'), 'suggest', '--stream'], {
    cwd: repo,
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: join(home, '.config'),
      APPDATA: join(home, 'AppData', 'Roaming'),
      FORCE_COLOR: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });

  const result = await onceExit(child);
  assert.equal(result.code, 0);
  assert.match(stdout, /Streaming is not supported for the 'cohere' provider/);
  assert.doesNotMatch(stdout, /Streaming suggestions/);
});

test('suggest --stream reports parse failure for unparseable streamed output', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'commit-echo-e2e-stream-parse-'));
  const { home, repo, configDir } = await setupRepo(root);

  const server = createServer(async (req, res) => {
    if (req.url === '/chat/completions' && req.method === 'POST') {
      let body = '';
      req.setEncoding('utf8');
      for await (const chunk of req) body += chunk;

      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"not a numbered suggestion list"}}]}\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
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

  const child = spawn(process.execPath, [join(process.cwd(), 'dist/index.js'), 'suggest', '--stream'], {
    cwd: repo,
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: join(home, '.config'),
      APPDATA: join(home, 'AppData', 'Roaming'),
      FORCE_COLOR: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });

  const result = await onceExit(child);
  assert.equal(result.code, 0);
  assert.match(stdout, /not a numbered suggestion list/);
  assert.match(stdout, /Could not parse any suggestions from LLM response/);
});
