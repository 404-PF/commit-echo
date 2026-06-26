import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = join(fileURLToPath(import.meta.url), '..');
const getConfigDirUrl = pathToFileURL(join(__dirname, '..', 'dist', 'config', 'store.js')).href;

function getConfigDirInSubprocess({ platform: platformValue, home, appData, xdgConfigHome } = {}) {
  const env = { ...process.env };

  delete env.APPDATA;
  delete env.XDG_CONFIG_HOME;
  if (appData !== undefined) env.APPDATA = appData;
  if (xdgConfigHome !== undefined) env.XDG_CONFIG_HOME = xdgConfigHome;

  const script = `
    import { createRequire } from 'node:module';
    const require = createRequire(import.meta.url);
    const os = require('node:os');
    ${platformValue !== undefined ? `os.platform = () => ${JSON.stringify(platformValue)};` : ''}
    ${home !== undefined ? `os.homedir = () => ${JSON.stringify(home)};` : ''}
    const { getConfigDir } = await import(${JSON.stringify(getConfigDirUrl)});
    console.log(getConfigDir());
  `;

  const result = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    env,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  return result.trim();
}

test('getConfigDir returns APPDATA/commit-echo on win32 when APPDATA is set', () => {
  const dir = getConfigDirInSubprocess({
    platform: 'win32',
    home: 'C:\\Users\\test',
    appData: 'C:\\Users\\test\\AppData\\Roaming',
  });
  assert.equal(dir, join('C:\\Users\\test\\AppData\\Roaming', 'commit-echo'));
});

test('getConfigDir falls through to ~/.config/commit-echo on win32 when APPDATA is unset', () => {
  const dir = getConfigDirInSubprocess({
    platform: 'win32',
    home: 'C:\\Users\\test',
  });
  assert.equal(dir, join('C:\\Users\\test', '.config', 'commit-echo'));
});

test('getConfigDir returns ~/Library/Application Support/commit-echo on darwin', () => {
  const dir = getConfigDirInSubprocess({
    platform: 'darwin',
    home: '/Users/test',
  });
  assert.equal(dir, join('/Users/test', 'Library', 'Application Support', 'commit-echo'));
});

test('getConfigDir returns XDG_CONFIG_HOME/commit-echo on linux when XDG_CONFIG_HOME is set', () => {
  const dir = getConfigDirInSubprocess({
    platform: 'linux',
    home: '/home/user',
    xdgConfigHome: '/home/user/.xdg',
  });
  assert.equal(dir, join('/home/user/.xdg', 'commit-echo'));
});

test('getConfigDir returns ~/.config/commit-echo on linux when XDG_CONFIG_HOME is unset', () => {
  const dir = getConfigDirInSubprocess({
    platform: 'linux',
    home: '/home/user',
  });
  assert.equal(dir, join('/home/user', '.config', 'commit-echo'));
});
