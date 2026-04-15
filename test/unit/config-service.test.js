const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { resolveConfig } = require('../../dist/features/config/application/config-service');

test('resolveConfig returns model and transport fields from config file', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-config-'));
  fs.mkdirSync(path.join(repoPath, '.bateye'), { recursive: true });
  fs.writeFileSync(path.join(repoPath, '.bateye', 'config.json'), JSON.stringify({
    model: 'anthropic/test-model',
    transport: 'vercel',
    apiBaseUrl: 'https://ai-gateway.vercel.sh/v3/ai',
    exclude: ['generated'],
  }, null, 2));

  const config = resolveConfig(repoPath);
  assert.equal(config.model, 'anthropic/test-model');
  assert.equal(config.transport, 'vercel');
  assert.equal(config.apiBaseUrl, 'https://ai-gateway.vercel.sh/v3/ai');
  assert.deepEqual(config.exclude, ['generated']);
});

test('resolveConfig falls back to defaults when config is empty', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-config-defaults-'));
  // No config file - resolveConfig should use defaults
  const config = resolveConfig(repoPath);
  assert.ok(typeof config.model === 'string' && config.model.length > 0);
  assert.equal(config.transport, 'auto');
  assert.equal(config.apiBaseUrl, undefined);
  assert.deepEqual(config.exclude, []);
});

test('resolveConfig lets config.local.json override shared config fields', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-config-local-'));
  fs.mkdirSync(path.join(repoPath, '.bateye'), { recursive: true });
  fs.writeFileSync(path.join(repoPath, '.bateye', 'config.json'), JSON.stringify({
    model: 'anthropic/test-model',
    transport: 'auto',
    exclude: ['generated'],
  }, null, 2));
  fs.writeFileSync(path.join(repoPath, '.bateye', 'config.local.json'), JSON.stringify({
    model: 'openai/local-model',
    transport: 'vercel',
  }, null, 2));

  const config = resolveConfig(repoPath);
  assert.equal(config.model, 'openai/local-model');
  assert.equal(config.transport, 'vercel');
  assert.deepEqual(config.exclude, ['generated']);
});

test('resolveConfig trims blank secret placeholders to undefined', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-config-secrets-'));
  fs.mkdirSync(path.join(repoPath, '.bateye'), { recursive: true });
  fs.writeFileSync(path.join(repoPath, '.bateye', 'config.local.json'), JSON.stringify({
    apiKey: '   ',
    githubToken: '',
  }, null, 2));

  const config = resolveConfig(repoPath);
  assert.equal(config.apiKey, undefined);
  assert.equal(config.githubToken, undefined);
});
