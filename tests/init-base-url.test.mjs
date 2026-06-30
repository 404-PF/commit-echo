import assert from 'node:assert/strict';
import test from 'node:test';

import { initCommand, normalizeBaseUrl } from '../dist/commands/init.js';

test('handles single trailing slash', () => {
  assert.equal(normalizeBaseUrl('https://api.example.com/v1/'), 'https://api.example.com/v1');
});

test('trims multiple trailing slashes from custom base URLs', () => {
  assert.equal(normalizeBaseUrl('https://api.example.com/v1///'), 'https://api.example.com/v1');
});

test('preserves custom base URLs without trailing slashes', () => {
  assert.equal(normalizeBaseUrl('https://api.example.com/v1'), 'https://api.example.com/v1');
});

test('initCommand saves normalized custom provider base URL', async () => {
  const savedConfigs = [];
  const selectedValues = ['__custom__', 'custom-model'];
  const textValues = ['https://api.example.com/v1/', 'test-api-key', '50'];
  const spinnerStub = {
    start() {},
    stop() {},
  };

  await initCommand(
    {},
    {
      intro() {},
      outro() {},
      select: async () => selectedValues.shift(),
      text: async () => textValues.shift(),
      confirm: async () => false,
      spinner: () => spinnerStub,
      isCancel: () => false,
      configExists: () => false,
      fetchModels: async (provider, baseUrl) => {
        assert.equal(provider, '__custom__');
        assert.equal(baseUrl, 'https://api.example.com/v1');
        return ['custom-model'];
      },
      saveConfig: async (config) => {
        savedConfigs.push(config);
      },
      testConnection: async (config) => {
        assert.equal(config.baseUrl, 'https://api.example.com/v1');
        return config.model;
      },
    },
  );

  assert.equal(savedConfigs.length, 1);
  assert.equal(savedConfigs[0].provider, '__custom__');
  assert.equal(savedConfigs[0].baseUrl, 'https://api.example.com/v1');
});
