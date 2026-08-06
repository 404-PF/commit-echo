import assert from 'node:assert/strict';
import test from 'node:test';

import {
  substituteTemplateVars,
  resolveSystemPrompt,
  resolveUserPrompt,
  resolvePrompts,
  loadTemplateFile,
  getAvailableTemplateVars,
} from '../dist/llm/prompt.js';

const EMPTY_PROFILE = {
  avgLength: 0,
  commonPrefixes: [],
  prefixRates: {},
  imperativeRate: 0,
  sentenceCaseRate: 0,
  usesScopeRate: 0,
  usesBodyRate: 0,
  totalCommits: 0,
};

test('substituteTemplateVars replaces all known variables', () => {
  const result = substituteTemplateVars(
    'Branch: {{branch}}\nDiff: {{diff}}\nProfile: {{profile}}\nMessage: {{message}}',
    { diff: 'my diff', profile: 'my profile', branch: 'main', message: 'my message' }
  );

  assert.equal(result, 'Branch: main\nDiff: my diff\nProfile: my profile\nMessage: my message');
});

test('substituteTemplateVars replaces message variable', () => {
  const result = substituteTemplateVars(
    'Message: {{message}}',
    { diff: '', profile: '', branch: '', message: 'chore: first commit' }
  );

  assert.equal(result, 'Message: chore: first commit');
});

test('substituteTemplateVars handles empty message', () => {
  const result = substituteTemplateVars(
    'Message: {{message}}',
    { diff: '', profile: '', branch: '', message: '' }
  );

  assert.equal(result, 'Message: ');
});

test('substituteTemplateVars leaves unknown variables as-is', () => {
  const result = substituteTemplateVars(
    'Hello {{unknown}} world {{diff}}',
    { diff: 'DIFF', profile: '', branch: '' }
  );

  assert.equal(result, 'Hello {{unknown}} world DIFF');
});

test('substituteTemplateVars handles empty template', () => {
  const result = substituteTemplateVars(
    '',
    { diff: '', profile: '', branch: '' }
  );

  assert.equal(result, '');
});

test('substituteTemplateVars replaces multiple occurrences', () => {
  const result = substituteTemplateVars(
    '{{diff}} and {{diff}}',
    { diff: 'SAME', profile: '', branch: '' }
  );

  assert.equal(result, 'SAME and SAME');
});

test('substituteTemplateVars does not rescan substituted values', () => {
  const result = substituteTemplateVars(
    'Analyze:\n{{diff}}\n\nProfile: {{profile}}',
    {
      diff: 'diff contains literal {{profile}} and {{branch}} markers',
      profile: 'learned profile',
      branch: 'main',
    }
  );

  assert.equal(
    result,
    'Analyze:\ndiff contains literal {{profile}} and {{branch}} markers\n\nProfile: learned profile'
  );
});

test('resolveSystemPrompt falls back to built-in when no config template', async () => {
  const prompt = await resolveSystemPrompt(EMPTY_PROFILE, {
    diff: '',
    profile: '',
    branch: 'main',
  });

  assert.ok(prompt.includes('expert Git commit message assistant'));
  assert.ok(prompt.includes('No previous commit history available'));
});

test('resolveSystemPrompt uses custom template when configured', async () => {
  const prompt = await resolveSystemPrompt(EMPTY_PROFILE, {
    diff: 'my diff',
    profile: 'my profile',
    branch: 'feature-x',
    message: 'last commit msg',
  }, {
    provider: '',
    model: '',
    historySize: 0,
    maxDiffSize: 0,
    systemPromptTemplate: 'Branch: {{branch}} | Profile: {{profile}} | Message: {{message}}',
  });

  assert.equal(prompt, 'Branch: feature-x | Profile: my profile | Message: last commit msg');
  assert.ok(!prompt.includes('expert Git commit message assistant'));
});

test('resolveUserPrompt falls back to built-in when no config template', async () => {
  const prompt = await resolveUserPrompt({
    diff: 'test diff',
    profile: '',
    branch: '',
  });

  assert.ok(prompt.includes('Generate 3 commit message suggestions'));
  assert.ok(prompt.includes('test diff'));
});

test('resolveUserPrompt uses custom template when configured', async () => {
  const prompt = await resolveUserPrompt({
    diff: 'some diff',
    profile: '',
    branch: 'main',
    message: 'another message',
  }, {
    provider: '',
    model: '',
    historySize: 0,
    maxDiffSize: 0,
    userPromptTemplate: 'Branch: {{branch}}\n\n{{diff}}\n\nPrev: {{message}}',
  });

  assert.equal(prompt, 'Branch: main\n\nsome diff\n\nPrev: another message');
  assert.ok(!prompt.includes('Generate 3 commit message suggestions'));
});

test('resolveSystemPrompt falls back to built-in when systemPromptTemplate is empty string', async () => {
  const prompt = await resolveSystemPrompt(EMPTY_PROFILE, {
    diff: '',
    profile: '',
    branch: 'main',
  }, {
    provider: '',
    model: '',
    historySize: 0,
    maxDiffSize: 0,
    systemPromptTemplate: '',
  });

  assert.ok(prompt.includes('expert Git commit message assistant'));
  assert.ok(prompt.includes('No previous commit history available'));
  assert.ok(!prompt.includes('Branch:'));
});

test('getAvailableTemplateVars returns variable descriptions', () => {
  const vars = getAvailableTemplateVars();

  assert.ok(vars.includes('{{diff}}'));
  assert.ok(vars.includes('{{profile}}'));
  assert.ok(vars.includes('{{branch}}'));
  assert.ok(vars.includes('{{message}}'));
});

// --- Template file loading tests ---

import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function withTempFile(content, run) {
  const dir = await mkdtemp(`${tmpdir()}/commit-echo-tpl-`);
  const filePath = join(dir, 'template.md');
  await writeFile(filePath, content, 'utf-8');
  try {
    await run(filePath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('resolveSystemPrompt loads from template file (system prompt only)', async () => {
  await withTempFile('You are a commit assistant for branch {{branch}}.\nProfile: {{profile}}', async (filePath) => {
    const prompt = await resolveSystemPrompt(EMPTY_PROFILE, {
      diff: '',
      profile: 'learned style',
      branch: 'main',
      message: '',
    }, {
      provider: '',
      model: '',
      historySize: 0,
      maxDiffSize: 0,
      templatePath: filePath,
    });

    assert.equal(prompt, 'You are a commit assistant for branch main.\nProfile: learned style');
    assert.ok(!prompt.includes('expert Git commit message assistant'));
  });
});

test('resolveUserPrompt loads from template file (user prompt after separator)', async () => {
  await withTempFile('System: {{branch}}\n---\nUser: {{diff}}', async (filePath) => {
    const prompt = await resolveUserPrompt({
      diff: 'my diff content',
      profile: '',
      branch: 'feature-x',
      message: '',
    }, {
      provider: '',
      model: '',
      historySize: 0,
      maxDiffSize: 0,
      templatePath: filePath,
    });

    assert.equal(prompt, 'User: my diff content');
  });
});

test('resolveSystemPrompt loads system part from template file with separator', async () => {
  await withTempFile('System prompt for {{branch}}\n---\nUser prompt for {{diff}}', async (filePath) => {
    const prompt = await resolveSystemPrompt(EMPTY_PROFILE, {
      diff: '',
      profile: '',
      branch: 'develop',
      message: '',
    }, {
      provider: '',
      model: '',
      historySize: 0,
      maxDiffSize: 0,
      templatePath: filePath,
    });

    assert.equal(prompt, 'System prompt for develop');
  });
});

test('resolveSystemPrompt falls back to built-in when template file has only user prompt', async () => {
  await withTempFile('---\nUser prompt: {{diff}}', async (filePath) => {
    const prompt = await resolveSystemPrompt(EMPTY_PROFILE, {
      diff: '',
      profile: '',
      branch: 'main',
      message: '',
    }, {
      provider: '',
      model: '',
      historySize: 0,
      maxDiffSize: 0,
      templatePath: filePath,
    });

    assert.ok(prompt.includes('expert Git commit message assistant'));
  });
});

test('resolveUserPrompt falls back to built-in when template file has only system prompt', async () => {
  await withTempFile('System prompt only: {{branch}}', async (filePath) => {
    const prompt = await resolveUserPrompt({
      diff: 'test diff',
      profile: '',
      branch: 'main',
      message: '',
    }, {
      provider: '',
      model: '',
      historySize: 0,
      maxDiffSize: 0,
      templatePath: filePath,
    });

    assert.ok(prompt.includes('Generate 3 commit message suggestions'));
    assert.ok(prompt.includes('test diff'));
  });
});

test('resolveSystemPrompt throws for missing template file', async () => {
  await assert.rejects(
    resolveSystemPrompt(EMPTY_PROFILE, {
      diff: '',
      profile: '',
      branch: 'main',
      message: '',
    }, {
      provider: '',
      model: '',
      historySize: 0,
      maxDiffSize: 0,
      templatePath: '/nonexistent/path/to/template.md',
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Failed to read template file/);
      assert.match(error.message, /nonexistent\/path\/to\/template\.md/);
      return true;
    },
  );
});

test('templatePath takes precedence over systemPromptTemplate', async () => {
  await withTempFile('File template: {{branch}}', async (filePath) => {
    const prompt = await resolveSystemPrompt(EMPTY_PROFILE, {
      diff: '',
      profile: '',
      branch: 'feature-from-file',
      message: '',
    }, {
      provider: '',
      model: '',
      historySize: 0,
      maxDiffSize: 0,
      templatePath: filePath,
      systemPromptTemplate: 'Inline: {{branch}}',
    });

    assert.equal(prompt, 'File template: feature-from-file');
    assert.ok(!prompt.startsWith('Inline:'));
  });
});

test('templatePath takes precedence over userPromptTemplate', async () => {
  await withTempFile('---\nFile user: {{diff}}', async (filePath) => {
    const prompt = await resolveUserPrompt({
      diff: 'file diff',
      profile: '',
      branch: 'main',
      message: '',
    }, {
      provider: '',
      model: '',
      historySize: 0,
      maxDiffSize: 0,
      templatePath: filePath,
      userPromptTemplate: 'Inline: {{diff}}',
    });

    assert.equal(prompt, 'File user: file diff');
    assert.ok(!prompt.startsWith('Inline:'));
  });
});

test('inline systemPromptTemplate is ignored when template file has no system prompt', async () => {
  await withTempFile('---\nUser prompt: {{diff}}', async (filePath) => {
    const prompt = await resolveSystemPrompt(EMPTY_PROFILE, {
      diff: '',
      profile: '',
      branch: 'main',
      message: '',
    }, {
      provider: '',
      model: '',
      historySize: 0,
      maxDiffSize: 0,
      templatePath: filePath,
      systemPromptTemplate: 'Inline: {{branch}}',
    });

    assert.ok(prompt.includes('expert Git commit message assistant'));
    assert.ok(!prompt.includes('Inline:'));
  });
});

test('inline userPromptTemplate is ignored when template file has no user prompt', async () => {
  await withTempFile('System prompt only: {{branch}}', async (filePath) => {
    const prompt = await resolveUserPrompt({
      diff: 'test diff',
      profile: '',
      branch: 'main',
      message: '',
    }, {
      provider: '',
      model: '',
      historySize: 0,
      maxDiffSize: 0,
      templatePath: filePath,
      userPromptTemplate: 'Inline: {{diff}}',
    });

    assert.ok(prompt.includes('Generate 3 commit message suggestions'));
    assert.ok(prompt.includes('test diff'));
    assert.ok(!prompt.includes('Inline:'));
  });
});

test('trailing --- separator does not leak into the system prompt', async () => {
  await withTempFile('System prompt for {{branch}}\n---', async (filePath) => {
    const prompt = await resolveSystemPrompt(EMPTY_PROFILE, {
      diff: '',
      profile: '',
      branch: 'main',
      message: '',
    }, {
      provider: '',
      model: '',
      historySize: 0,
      maxDiffSize: 0,
      templatePath: filePath,
    });

    assert.equal(prompt, 'System prompt for main');
    assert.ok(!prompt.includes('---'));
  });
});

test('trailing --- separator leaves user prompt to the built-in', async () => {
  await withTempFile('System prompt for {{branch}}\n---', async (filePath) => {
    const prompt = await resolveUserPrompt({
      diff: 'test diff',
      profile: '',
      branch: 'main',
      message: '',
    }, {
      provider: '',
      model: '',
      historySize: 0,
      maxDiffSize: 0,
      templatePath: filePath,
    });

    assert.ok(prompt.includes('Generate 3 commit message suggestions'));
    assert.ok(prompt.includes('test diff'));
  });
});

test('bare --- separator yields no system or user template', async () => {
  await withTempFile('---', async (filePath) => {
    const loaded = await loadTemplateFile(filePath);
    assert.equal(loaded.systemTemplate, undefined);
    assert.equal(loaded.userTemplate, undefined);
  });
});

// --- resolvePrompts (shared-load) tests ---

const PROMPT_CONFIG = (filePath) => ({
  provider: '',
  model: '',
  historySize: 0,
  maxDiffSize: 0,
  templatePath: filePath,
});

test('resolvePrompts uses file system prompt and built-in user prompt', async () => {
  await withTempFile('System prompt for {{branch}}', async (filePath) => {
    const [systemPrompt, userPrompt] = await resolvePrompts(EMPTY_PROFILE, {
      diff: 'test diff',
      profile: '',
      branch: 'main',
      message: '',
    }, PROMPT_CONFIG(filePath));

    assert.equal(systemPrompt, 'System prompt for main');
    assert.ok(userPrompt.includes('Generate 3 commit message suggestions'));
    assert.ok(userPrompt.includes('test diff'));
  });
});

test('resolvePrompts uses file user prompt and built-in system prompt', async () => {
  await withTempFile('---\nUser prompt: {{diff}}', async (filePath) => {
    const [systemPrompt, userPrompt] = await resolvePrompts(EMPTY_PROFILE, {
      diff: 'my diff',
      profile: '',
      branch: 'main',
      message: '',
    }, PROMPT_CONFIG(filePath));

    assert.ok(systemPrompt.includes('expert Git commit message assistant'));
    assert.equal(userPrompt, 'User prompt: my diff');
  });
});

test('resolvePrompts uses both file templates when both are present', async () => {
  await withTempFile('System: {{branch}}\n---\nUser: {{diff}}', async (filePath) => {
    const [systemPrompt, userPrompt] = await resolvePrompts(EMPTY_PROFILE, {
      diff: 'my diff',
      profile: '',
      branch: 'feature-x',
      message: '',
    }, PROMPT_CONFIG(filePath));

    assert.equal(systemPrompt, 'System: feature-x');
    assert.equal(userPrompt, 'User: my diff');
  });
});

test('resolvePrompts uses built-in prompts when no templatePath is set', async () => {
  const [systemPrompt, userPrompt] = await resolvePrompts(EMPTY_PROFILE, {
    diff: 'test diff',
    profile: '',
    branch: 'main',
    message: '',
  });

  assert.ok(systemPrompt.includes('expert Git commit message assistant'));
  assert.ok(userPrompt.includes('Generate 3 commit message suggestions'));
  assert.ok(userPrompt.includes('test diff'));
});
