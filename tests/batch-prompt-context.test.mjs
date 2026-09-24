import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { batchCommand } from '../dist/commands/batch.js';
import { generateSuggestionsStream } from '../dist/llm/client.js';
import { CONFIG_ENV_VARS, getConfigPath, getHistoryPath, invalidateConfigCache } from '../dist/config/store.js';

function createTempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: 'pipe' });
}

function initRepo(root, name, branch, message) {
  const repoDir = join(root, name);
  mkdirSync(repoDir, { recursive: true });
  git(['init'], repoDir);
  git(['config', 'core.fsmonitor', 'false'], repoDir);
  git(['config', 'user.name', 'Test User'], repoDir);
  git(['config', 'user.email', 'test@example.com'], repoDir);
  writeFileSync(join(repoDir, 'file.txt'), name + ' base\n', 'utf-8');
  git(['add', 'file.txt'], repoDir);
  git(['commit', '-m', message], repoDir);
  git(['switch', '-c', branch], repoDir);
  writeFileSync(join(repoDir, 'file.txt'), name + ' staged change\n', 'utf-8');
  git(['add', 'file.txt'], repoDir);
  return repoDir;
}

function initConfig(baseUrl) {
  const configPath = getConfigPath();
  const historyPath = getHistoryPath();
  mkdirSync(join(configPath, '..'), { recursive: true });
  writeFileSync(
    configPath,
    JSON.stringify({
      provider: '__custom__',
      model: 'fixture-model',
      baseUrl,
      apiKey: 'test-key',
      historySize: 5,
      maxDiffSize: 4000,
      systemPromptTemplate: 'branch={{branch}};message={{message}}',
      userPromptTemplate: 'branch={{branch}};message={{message}};diff={{diff}}',
    }),
    'utf-8',
  );
  writeFileSync(historyPath, '', 'utf-8');
}

async function startFixtureServer(requests) {
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body);
    requests.push(payload);

    response.setHeader('Content-Type', payload.stream ? 'text/event-stream' : 'application/json');
    if (payload.stream) {
      response.write('data: {"model":"fixture-model","choices":[{"delta":{"content":"1. chore: stream fixture"}}]}\n\n');
      response.write('data: [DONE]\n\n');
      response.end();
      return;
    }

    response.end(JSON.stringify({
      model: 'fixture-model',
      choices: [{ message: { content: '1. chore: batch fixture' } }],
    }));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Fixture server did not expose a TCP address');
  }
  return { server, baseUrl: 'http://127.0.0.1:' + address.port + '/v1' };
}

async function stopServer(server) {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

test('batch resolves branch and previous message from each repository', async () => {
  const parent = createTempDir('commit-echo-batch-context-');
  const callerRepo = createTempDir('commit-echo-caller-');
  const configHome = createTempDir('commit-echo-config-');
  const previousCwd = process.cwd();
  const previousXdg = process.env.XDG_CONFIG_HOME;
  const previousHome = process.env.HOME;
  const previousAppData = process.env.APPDATA;
  const previousConfigEnv = Object.fromEntries(CONFIG_ENV_VARS.map((name) => [name, process.env[name]]));
  const requests = [];
  const { server, baseUrl } = await startFixtureServer(requests);

  try {
    for (const name of CONFIG_ENV_VARS) delete process.env[name];
    invalidateConfigCache();

    const repoA = initRepo(parent, 'alpha-repo', 'alpha-feature', 'alpha base commit');
    const repoB = initRepo(parent, 'beta-repo', 'beta-feature', 'beta base commit');
    git(['init'], callerRepo);
    git(['config', 'user.name', 'Test User'], callerRepo);
    git(['config', 'user.email', 'test@example.com'], callerRepo);
    git(['commit', '--allow-empty', '-m', 'caller commit'], callerRepo);
    git(['switch', '-c', 'caller-feature'], callerRepo);

    process.env.XDG_CONFIG_HOME = configHome;
    process.env.HOME = configHome;
    process.env.APPDATA = configHome;
    initConfig(baseUrl);
    process.chdir(callerRepo);

    const result = await batchCommand({ directory: parent, recursive: false, yes: true });

    assert.equal(result, true);
    assert.equal(requests.length, 2);

    const alphaRequest = requests.find((request) => JSON.stringify(request).includes('alpha-feature'));
    const betaRequest = requests.find((request) => JSON.stringify(request).includes('beta-feature'));
    assert.ok(alphaRequest);
    assert.ok(betaRequest);

    const alphaText = JSON.stringify(alphaRequest);
    const betaText = JSON.stringify(betaRequest);
    assert.match(alphaText, /alpha-feature/);
    assert.match(alphaText, /alpha base commit/);
    assert.doesNotMatch(alphaText, /caller-feature|caller commit|beta-feature|beta base commit/);
    assert.match(betaText, /beta-feature/);
    assert.match(betaText, /beta base commit/);
    assert.doesNotMatch(betaText, /caller-feature|caller commit|alpha-feature|alpha base commit/);

    assert.equal(git(['log', '-1', '--format=%s'], repoA).trim(), 'chore: batch fixture');
    assert.equal(git(['log', '-1', '--format=%s'], repoB).trim(), 'chore: batch fixture');
  } finally {
    process.chdir(previousCwd);
    if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousXdg;
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = previousAppData;
    for (const name of CONFIG_ENV_VARS) {
      const value = previousConfigEnv[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    invalidateConfigCache();
    await stopServer(server);
    rmSync(parent, { recursive: true, force: true });
    rmSync(callerRepo, { recursive: true, force: true });
    rmSync(configHome, { recursive: true, force: true });
  }
});

test('generateSuggestionsStream resolves repository context for its prompt', async () => {
  const repoRoot = createTempDir('commit-echo-stream-context-');
  const callerDir = createTempDir('commit-echo-stream-caller-');
  const requests = [];
  const { server, baseUrl } = await startFixtureServer(requests);
  const previousCwd = process.cwd();

  try {
    const repo = initRepo(repoRoot, 'stream-repo', 'stream-feature', 'stream base commit');
    process.chdir(callerDir);

    const events = [];
    for await (const event of generateSuggestionsStream(
      {
        provider: '__custom__',
        model: 'fixture-model',
        baseUrl,
        apiKey: 'test-key',
        historySize: 5,
        maxDiffSize: 4000,
        systemPromptTemplate: 'branch={{branch}};message={{message}}',
        userPromptTemplate: 'branch={{branch}};message={{message}};diff={{diff}}',
      },
      'diff --git a/file.txt b/file.txt\n',
      {
        avgLength: 0,
        commonPrefixes: [],
        prefixRates: {},
        imperativeRate: 0,
        sentenceCaseRate: 0,
        usesScopeRate: 0,
        usesBodyRate: 0,
        totalCommits: 0,
      },
      'test-key',
      undefined,
      undefined,
      repo,
    )) {
      events.push(event);
    }

    assert.equal(requests.length, 1);
    const requestText = JSON.stringify(requests[0]);
    assert.match(requestText, /stream-feature/);
    assert.match(requestText, /stream base commit/);
    assert.doesNotMatch(requestText, /caller/);
    assert.equal(events[0]?.kind, 'meta');
    assert.equal(events.filter((event) => event.kind === 'text').map((event) => event.text).join(''), '1. chore: stream fixture');
  } finally {
    process.chdir(previousCwd);
    await stopServer(server);
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(callerDir, { recursive: true, force: true });
  }
});
