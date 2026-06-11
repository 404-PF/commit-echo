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
