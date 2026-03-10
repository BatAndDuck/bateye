const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { resolveConfig } = require('../../dist/features/config/application/config-service');

test('resolveConfig supports direct apiKey and renamed env field', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'codeowl-config-'));
  fs.mkdirSync(path.join(repoPath, '.codeowl'), { recursive: true });
  fs.writeFileSync(path.join(repoPath, '.codeowl', 'config.json'), JSON.stringify({
    model: 'anthropic/test-model',
    lightModel: 'anthropic/test-light',
    apiKey: 'direct-key',
    apiKeyEnvVariable: 'CUSTOM_API_KEY',
    exclude: ['generated'],
  }, null, 2));

  const config = resolveConfig(repoPath);
  assert.equal(config.model, 'anthropic/test-model');
  assert.equal(config.lightModel, 'anthropic/test-light');
  assert.equal(config.apiKey, 'direct-key');
  assert.equal(config.apiKeyEnvVariable, 'CUSTOM_API_KEY');
  assert.deepEqual(config.exclude, ['generated']);
});

test('resolveConfig preserves backward compatibility with apiKeyEnv', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'codeowl-config-legacy-'));
  fs.mkdirSync(path.join(repoPath, '.codeowl'), { recursive: true });
  fs.writeFileSync(path.join(repoPath, '.codeowl', 'config.json'), JSON.stringify({
    apiKeyEnv: 'LEGACY_KEY',
  }, null, 2));

  const config = resolveConfig(repoPath);
  assert.equal(config.apiKeyEnvVariable, 'LEGACY_KEY');
});
