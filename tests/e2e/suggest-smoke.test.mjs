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

function stripAnsi(text) {
  return text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

function extractShownDiff(stdout) {
  const match = stdout.match(
    /Diff being analyzed:\n([\s\S]*?)\n\n(?:[\u007c\u2022\u25d0\u25d3\u25d1\u25d2\s]*Generating commit suggestions[\s\S]*?Suggestions generated:|The diff above is truncated|Streaming suggestions|Suggestions generated:)/,
  );
  assert.ok(match, `Could not find shown diff in stdout:\n${stdout}`);
  return match[1];
}

function extractPromptDiff(content) {
  const match = content.match(/```diff\n([\s\S]*?)\n```/);
  assert.ok(match, `Could not find prompt diff in request:\n${content}`);
  return match[1];
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
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
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

function runCli(args, { cwd, env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(process.cwd(), 'dist/index.js'), ...args], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGINT');
      reject(new Error(`Timed out running ${args.join(' ')}. stdout: ${stdout} stderr: ${stderr}`));
    }, 8000);
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal, stdout, stderr });
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

function cliEnvFor(home) {
  return {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    APPDATA: join(home, 'AppData', 'Roaming'),
    FORCE_COLOR: '0',
  };
}

async function setupRepo(root) {
  const home = join(root, 'home');
  const repo = join(root, 'repo');
  await mkdir(home, { recursive: true });
  await mkdir(repo, { recursive: true });

  execFileSync('git', ['init'], { cwd: repo });
  execFileSync('git', ['config', 'core.fsmonitor', 'false'], { cwd: repo });
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

function createChatCompletionServer({ content, streamContent, requireStream = false }) {
  const requests = [];
  const server = createServer(async (req, res) => {
    if (req.url === '/chat/completions' && req.method === 'POST') {
      let body = '';
      req.setEncoding('utf8');
      for await (const chunk of req) body += chunk;
      const parsed = JSON.parse(body);
      requests.push(parsed);

      if (parsed.stream && streamContent) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: streamContent } }] })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      if (requireStream) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'expected streaming request' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          model: 'fixture-model',
          choices: [{ message: { content } }],
        }),
      );
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  return { requests, server };
}

async function writeCustomProviderConfig(configDir, port, extra = {}) {
  await writeFile(
    join(configDir, 'config.json'),
    JSON.stringify(
      {
        provider: '__custom__',
        model: 'fixture-model',
        baseUrl: `http://127.0.0.1:${port}`,
        apiKey: 'test-key',
        historySize: 5,
        ...extra,
      },
      null,
      2,
    ),
    'utf8',
  );
}

async function setupShowDiffFixture(
  t,
  { rootPrefix, content, streamContent, requireStream = false, readme, staged = true, maxDiffSize },
) {
  const root = await mkdtemp(join(tmpdir(), rootPrefix));
  const { home, repo, configDir } = await setupRepo(root);
  const { requests, server } = createChatCompletionServer({ content, streamContent, requireStream });
  const port = await listen(server);
  t.after(async () => {
    server.close();
    await rm(root, { recursive: true, force: true });
  });

  if (readme) {
    await writeFile(join(repo, 'README.md'), readme, 'utf8');
    execFileSync('git', ['add', 'README.md'], { cwd: repo });
  }

  if (!staged) {
    execFileSync('git', ['restore', '--staged', 'README.md'], { cwd: repo });
  }

  await writeCustomProviderConfig(configDir, port, maxDiffSize === undefined ? {} : { maxDiffSize });

  return { home, repo, requests };
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
      res.end(
        JSON.stringify({
          model: parsed.model,
          choices: [{ message: { content: '1. feat: add smoke test coverage\n2. docs: refresh quickstart examples' } }],
        }),
      );
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
    JSON.stringify(
      {
        provider: '__custom__',
        model: 'fixture-model',
        baseUrl: `http://127.0.0.1:${port}`,
        apiKey: 'test-key',
        historySize: 5,
      },
      null,
      2,
    ),
    'utf8',
  );

  await writeFile(
    join(configDir, 'history.jsonl'),
    JSON.stringify({
      timestamp: new Date().toISOString(),
      message: 'feat: add fixture history',
      diff: '',
      model: 'fixture-model',
      provider: '__custom__',
    }) + '\n',
    'utf8',
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

test('suggest --auto selects the first suggestion like --yes without committing', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'commit-echo-auto-suggest-'));
  const { home, repo, configDir } = await setupRepo(root);

  const server = createServer(async (req, res) => {
    if (req.url === '/chat/completions' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          model: 'fixture-model',
          choices: [{ message: { content: '1. feat: choose first alias\n2. docs: should not select' } }],
        }),
      );
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

  await writeCustomProviderConfig(configDir, port);

  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    APPDATA: join(home, 'AppData', 'Roaming'),
    FORCE_COLOR: '0',
  };

  const yes = await runCli(['suggest', '--yes'], { cwd: repo, env });
  const auto = await runCli(['suggest', '--auto'], { cwd: repo, env });

  for (const result of [yes, auto]) {
    const stdout = stripAnsi(result.stdout);
    assert.equal(result.code, 0);
    assert.equal(result.signal, null);
    assert.equal(result.stderr, '');
    assert.match(stdout, /Suggestions generated:/);
    assert.match(stdout, /Selected:\s+feat: choose first alias/);
    assert.doesNotMatch(stdout, /Choose an action/);
  }

  assert.equal(
    execFileSync('git', ['log', '-1', '--pretty=%s'], { cwd: repo, encoding: 'utf8' }).trim(),
    'feat: initial fixture',
  );
});

test('top-level --auto commits the first suggestion like --yes', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'commit-echo-auto-commit-'));
  const yesFixture = await setupRepo(join(root, 'yes'));
  const autoFixture = await setupRepo(join(root, 'auto'));

  const server = createServer(async (req, res) => {
    if (req.url === '/chat/completions' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          model: 'fixture-model',
          choices: [{ message: { content: '1. feat: auto alias parity\n2. docs: should not commit' } }],
        }),
      );
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

  await writeCustomProviderConfig(yesFixture.configDir, port);
  await writeCustomProviderConfig(autoFixture.configDir, port);

  const envFor = (home) => ({
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    APPDATA: join(home, 'AppData', 'Roaming'),
    FORCE_COLOR: '0',
  });

  const yes = await runCli(['--yes'], { cwd: yesFixture.repo, env: envFor(yesFixture.home) });
  const auto = await runCli(['--auto'], { cwd: autoFixture.repo, env: envFor(autoFixture.home) });

  for (const [result, repo] of [
    [yes, yesFixture.repo],
    [auto, autoFixture.repo],
  ]) {
    const stdout = stripAnsi(result.stdout);
    assert.equal(result.code, 0);
    assert.equal(result.signal, null);
    assert.equal(result.stderr, '');
    assert.match(stdout, /Selected:\s+feat: auto alias parity/);
    assert.equal(
      execFileSync('git', ['log', '-1', '--pretty=%s'], { cwd: repo, encoding: 'utf8' }).trim(),
      'feat: auto alias parity',
    );
  }
});

test('suggest reports no changes before checking for an API key', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'commit-echo-no-changes-'));
  const { home, repo, configDir } = await setupRepo(root);

  execFileSync('git', ['add', 'README.md'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'feat: settle fixture'], { cwd: repo });

  await writeFile(
    join(configDir, 'config.json'),
    JSON.stringify(
      {
        provider: 'openai',
        model: 'gpt-4.1',
        historySize: 5,
        maxDiffSize: 4000,
      },
      null,
      2,
    ),
    'utf8',
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
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

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
      res.end(
        JSON.stringify({
          model: parsed.model,
          choices: [{ message: { content: '1. feat: add override flag\n2. test: cover model alias' } }],
        }),
      );
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
    JSON.stringify(
      {
        provider: '__custom__',
        model: 'configured-model',
        baseUrl: `http://127.0.0.1:${port}`,
        apiKey: 'test-key',
        historySize: 5,
      },
      null,
      2,
    ),
    'utf8',
  );

  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    APPDATA: join(home, 'AppData', 'Roaming'),
    FORCE_COLOR: '0',
  };

  const longFlag = await runSuggestUntil(['suggest', '--yes', '--verbose', '--model', 'gpt-4o'], {
    cwd: repo,
    env,
    text: 'Model: gpt-4o',
  });
  assert.equal(requests.at(-1).model, 'gpt-4o');
  assert.match(longFlag.stdout, /Model: gpt-4o/);

  await runSuggestUntil(['suggest', '-m', 'claude-3-5-sonnet'], { cwd: repo, env, text: 'Suggestions generated:' });
  assert.equal(requests.at(-1).model, 'claude-3-5-sonnet');
});

test('suggest --show-diff prints the truncated staged diff before generating suggestions', async (t) => {
  const { home, repo, requests } = await setupShowDiffFixture(t, {
    rootPrefix: 'commit-echo-show-diff-staged-',
    content: '1. feat: inspect staged diff',
    readme: ['# fixture', '', ...Array.from({ length: 40 }, (_, i) => `line ${i}`)].join('\n') + '\n',
    maxDiffSize: 120,
  });

  const result = await runCli(['suggest', '--show-diff', '--yes'], { cwd: repo, env: cliEnvFor(home) });
  const stdout = stripAnsi(result.stdout);
  const stderr = stripAnsi(result.stderr);

  assert.equal(result.code, 0);
  assert.match(stdout, /Diff being analyzed:/);
  assert.match(stdout, /diff --git a\/README\.md b\/README\.md/);
  assert.match(stdout, /\[\.\.\.truncated 1 file\.\.\.\]/);
  assert.ok(stdout.indexOf('Diff being analyzed:') < stdout.indexOf('Suggestions generated:'));
  assert.match(stdout, /Selected:\s+feat: inspect staged diff/);
  assert.match(stderr, /Diff truncated:/);
  assert.match(requests.at(-1).messages[1].content, /\[\.\.\.truncated 1 file\.\.\.\]/);
  assert.equal(extractPromptDiff(requests.at(-1).messages[1].content), extractShownDiff(stdout));
});

test('suggest --show-diff works with unstaged changes in auto mode', async (t) => {
  const { home, repo, requests } = await setupShowDiffFixture(t, {
    rootPrefix: 'commit-echo-show-diff-unstaged-',
    content: '1. feat: inspect unstaged diff',
    staged: false,
  });

  const result = await runCli(['suggest', '--show-diff', '--yes'], { cwd: repo, env: cliEnvFor(home) });
  const stdout = stripAnsi(result.stdout);

  assert.equal(result.code, 0);
  assert.equal(result.stderr, '');
  assert.match(stdout, /Diff being analyzed:/);
  assert.match(stdout, /diff --git a\/README\.md b\/README\.md/);
  assert.match(stdout, /\+updated/);
  assert.doesNotMatch(stdout, /Use unstaged changes for suggestions/);
  assert.match(stdout, /Selected:\s+feat: inspect unstaged diff/);
  assert.match(requests.at(-1).messages[1].content, /\+updated/);
  assert.equal(extractPromptDiff(requests.at(-1).messages[1].content), extractShownDiff(stdout));
});

test('suggest --show-diff uses the truncated diff for streamed suggestions', async (t) => {
  const { home, repo, requests } = await setupShowDiffFixture(t, {
    rootPrefix: 'commit-echo-show-diff-stream-',
    streamContent: '1. feat: streamed diff preview',
    requireStream: true,
    readme: ['# fixture', '', ...Array.from({ length: 40 }, (_, i) => `stream line ${i}`)].join('\n') + '\n',
    maxDiffSize: 120,
  });

  const result = await runCli(['suggest', '--show-diff', '--stream', '--yes'], { cwd: repo, env: cliEnvFor(home) });
  const stdout = stripAnsi(result.stdout);
  const stderr = stripAnsi(result.stderr);
  const request = requests.at(-1);

  assert.equal(result.code, 0);
  assert.match(stdout, /Diff being analyzed:/);
  assert.match(stdout, /diff --git a\/README\.md b\/README\.md/);
  assert.match(stdout, /\[\.\.\.truncated 1 file\.\.\.\]/);
  assert.ok(stdout.indexOf('Diff being analyzed:') < stdout.indexOf('Streaming suggestions'));
  assert.match(stdout, /feat: streamed diff preview/);
  assert.match(stdout, /Selected:\s+feat: streamed diff preview/);
  assert.match(stderr, /Diff truncated:/);
  assert.equal(request?.stream, true);
  assert.match(request.messages[1].content, /\[\.\.\.truncated 1 file\.\.\.\]/);
  assert.equal(extractPromptDiff(request.messages[1].content), extractShownDiff(stdout));
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
      res.end(
        JSON.stringify({
          model: parsed.model,
          choices: [{ message: { content: '1. feat: fallback suggestion' } }],
        }),
      );
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
    JSON.stringify(
      {
        provider: '__custom__',
        model: 'fixture-model',
        baseUrl: `http://127.0.0.1:${port}`,
        apiKey: 'test-key',
        historySize: 5,
      },
      null,
      2,
    ),
    'utf8',
  );

  const { stdout } = await runSuggestUntil(['suggest', '--stream'], {
    cwd: repo,
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: join(home, '.config'),
      APPDATA: join(home, 'AppData', 'Roaming'),
      FORCE_COLOR: '0',
    },
    text: 'feat: streamed suggestion',
  });

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
      res.end(
        JSON.stringify({
          model: parsed.model,
          content: [{ type: 'text', text: '1. feat: anthropic fallback suggestion' }],
        }),
      );
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
    JSON.stringify(
      {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        baseUrl: `http://127.0.0.1:${port}/v1`,
        apiKey: 'test-key',
        historySize: 5,
      },
      null,
      2,
    ),
    'utf8',
  );

  const { stdout } = await runSuggestUntil(['suggest', '--stream'], {
    cwd: repo,
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: join(home, '.config'),
      APPDATA: join(home, 'AppData', 'Roaming'),
      FORCE_COLOR: '0',
    },
    text: 'feat: anthropic streamed suggestion',
  });

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
      res.end(
        JSON.stringify({
          model: parsed.model,
          choices: [{ message: { content: '1. feat: fallback suggestion' } }],
        }),
      );
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
    JSON.stringify(
      {
        provider: '__custom__',
        model: 'fixture-model',
        baseUrl: `http://127.0.0.1:${port}`,
        apiKey: 'test-key',
        historySize: 5,
      },
      null,
      2,
    ),
    'utf8',
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
    JSON.stringify(
      {
        provider: 'cohere',
        model: 'command-r',
        apiKey: 'test-key',
        historySize: 5,
      },
      null,
      2,
    ),
    'utf8',
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
    JSON.stringify(
      {
        provider: '__custom__',
        model: 'fixture-model',
        baseUrl: `http://127.0.0.1:${port}`,
        apiKey: 'test-key',
        historySize: 5,
      },
      null,
      2,
    ),
    'utf8',
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
