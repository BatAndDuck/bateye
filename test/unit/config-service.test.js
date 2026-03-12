const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { resolveConfig } = require('../../dist/features/config/application/config-service');

test('resolveConfig returns model and transport fields from config file', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'codeowl-config-'));
  fs.mkdirSync(path.join(repoPath, '.codeowl'), { recursive: true });
  fs.writeFileSync(path.join(repoPath, '.codeowl', 'config.json'), JSON.stringify({
    model: 'anthropic/test-model',
    transport: 'vercel',
    apiBaseUrl: 'https://ai-gateway.vercel.sh/v1',
    exclude: ['generated'],
  }, null, 2));

  const config = resolveConfig(repoPath);
  assert.equal(config.model, 'anthropic/test-model');
  assert.equal(config.transport, 'vercel');
  assert.equal(config.apiBaseUrl, 'https://ai-gateway.vercel.sh/v1');
  assert.deepEqual(config.exclude, ['generated']);
});

test('resolveConfig falls back to defaults when config is empty', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'codeowl-config-defaults-'));
  // No config file — resolveConfig should use defaults
  const config = resolveConfig(repoPath);
  assert.ok(typeof config.model === 'string' && config.model.length > 0);
  assert.equal(config.transport, 'auto');
  assert.equal(config.apiBaseUrl, undefined);
  assert.deepEqual(config.exclude, []);
});
