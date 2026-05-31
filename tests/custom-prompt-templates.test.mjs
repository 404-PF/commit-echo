import assert from 'node:assert/strict';
import test from 'node:test';

import {
  substituteTemplateVars,
  resolveSystemPrompt,
  resolveUserPrompt,
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
    'Branch: {{branch}}\nDiff: {{diff}}\nProfile: {{profile}}',
    { diff: 'my diff', profile: 'my profile', branch: 'main' }
  );

  assert.equal(result, 'Branch: main\nDiff: my diff\nProfile: my profile');
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

test('resolveSystemPrompt falls back to built-in when no config template', () => {
  const prompt = resolveSystemPrompt(EMPTY_PROFILE, {
    diff: '',
    profile: '',
    branch: 'main',
  });

  assert.ok(prompt.includes('expert Git commit message assistant'));
  assert.ok(prompt.includes('No previous commit history available'));
});

test('resolveSystemPrompt uses custom template when configured', () => {
  const prompt = resolveSystemPrompt(EMPTY_PROFILE, {
    diff: 'my diff',
    profile: 'my profile',
    branch: 'feature-x',
  }, {
    provider: '',
    model: '',
    historySize: 0,
    maxDiffSize: 0,
    systemPromptTemplate: 'Branch: {{branch}} | Profile: {{profile}}',
  });

  assert.equal(prompt, 'Branch: feature-x | Profile: my profile');
  assert.ok(!prompt.includes('expert Git commit message assistant'));
});

test('resolveUserPrompt falls back to built-in when no config template', () => {
  const prompt = resolveUserPrompt({
    diff: 'test diff',
    profile: '',
    branch: '',
  });

  assert.ok(prompt.includes('Generate 3 commit message suggestions'));
  assert.ok(prompt.includes('test diff'));
});

test('resolveUserPrompt uses custom template when configured', () => {
  const prompt = resolveUserPrompt({
    diff: 'some diff',
    profile: '',
    branch: 'main',
  }, {
    provider: '',
    model: '',
    historySize: 0,
    maxDiffSize: 0,
    userPromptTemplate: 'Branch: {{branch}}\n\n{{diff}}',
  });

  assert.equal(prompt, 'Branch: main\n\nsome diff');
  assert.ok(!prompt.includes('Generate 3 commit message suggestions'));
});

test('resolveSystemPrompt falls back to built-in when systemPromptTemplate is empty string', () => {
  const prompt = resolveSystemPrompt(EMPTY_PROFILE, {
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
