const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  loadConfig,
  saveConfig,
  resolveConfig,
  resolveApiKey,
  setConfigField,
} = require('../../dist/features/config/application/config-service');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'codeowl-cfg-'));
}

function writeConfig(repoPath, data) {
  const configDir = path.join(repoPath, '.codeowl');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify(data, null, 2));
}

// loadConfig
test('loadConfig returns empty object when config file does not exist', () => {
  const tmpDir = makeTmpDir();
  const config = loadConfig(tmpDir);
  assert.deepEqual(config, {});
});

test('loadConfig reads existing config file', () => {
  const tmpDir = makeTmpDir();
  writeConfig(tmpDir, { model: 'anthropic/claude-3', exclude: ['dist'] });
  const config = loadConfig(tmpDir);
  assert.equal(config.model, 'anthropic/claude-3');
  assert.deepEqual(config.exclude, ['dist']);
});

test('loadConfig throws on malformed JSON', () => {
  const tmpDir = makeTmpDir();
  fs.mkdirSync(path.join(tmpDir, '.codeowl'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, '.codeowl', 'config.json'), '{ invalid json }');
  assert.throws(() => loadConfig(tmpDir), /Failed to parse/);
});

// saveConfig
test('saveConfig writes config as formatted JSON with trailing newline', () => {
  const tmpDir = makeTmpDir();
  saveConfig(tmpDir, { model: 'anthropic/claude-3', exclude: ['dist'] });

  const content = fs.readFileSync(path.join(tmpDir, '.codeowl', 'config.json'), 'utf-8');
  assert.ok(content.endsWith('\n'));

  const parsed = JSON.parse(content);
  assert.equal(parsed.model, 'anthropic/claude-3');
  assert.deepEqual(parsed.exclude, ['dist']);
});

test('saveConfig creates .codeowl directory if it does not exist', () => {
  const tmpDir = makeTmpDir();
  assert.ok(!fs.existsSync(path.join(tmpDir, '.codeowl')));
  saveConfig(tmpDir, { model: 'anthropic/test' });
  assert.ok(fs.existsSync(path.join(tmpDir, '.codeowl', 'config.json')));
});

test('saveConfig overwrites existing config', () => {
  const tmpDir = makeTmpDir();
  saveConfig(tmpDir, { model: 'anthropic/old-model' });
  saveConfig(tmpDir, { model: 'anthropic/new-model' });
  const content = JSON.parse(
    fs.readFileSync(path.join(tmpDir, '.codeowl', 'config.json'), 'utf-8'),
  );
  assert.equal(content.model, 'anthropic/new-model');
});

// resolveConfig
test('resolveConfig uses default model when model is absent', () => {
  const tmpDir = makeTmpDir();
  const config = resolveConfig(tmpDir);
  assert.ok(config.model.startsWith('anthropic/'));
});

test('resolveConfig uses default apiKeyEnvVariable when absent', () => {
  const tmpDir = makeTmpDir();
  const config = resolveConfig(tmpDir);
  assert.ok(typeof config.apiKeyEnvVariable === 'string');
  assert.ok(config.apiKeyEnvVariable.length > 0);
});

test('resolveConfig uses config model when specified', () => {
  const tmpDir = makeTmpDir();
  writeConfig(tmpDir, { model: 'anthropic/claude-opus-4' });
  const config = resolveConfig(tmpDir);
  assert.equal(config.model, 'anthropic/claude-opus-4');
});

test('resolveConfig uses config apiKeyEnvVariable when specified', () => {
  const tmpDir = makeTmpDir();
  writeConfig(tmpDir, { apiKeyEnvVariable: 'MY_CUSTOM_API_KEY' });
  const config = resolveConfig(tmpDir);
  assert.equal(config.apiKeyEnvVariable, 'MY_CUSTOM_API_KEY');
});

test('resolveConfig returns empty exclude array when absent', () => {
  const tmpDir = makeTmpDir();
  const config = resolveConfig(tmpDir);
  assert.deepEqual(config.exclude, []);
});

// resolveApiKey
test('resolveApiKey returns API key from environment variable', () => {
  const envVarName = `CODEOWL_TEST_KEY_${Date.now()}`;
  process.env[envVarName] = 'my-test-api-key-12345';
  try {
    const key = resolveApiKey({ apiKeyEnvVariable: envVarName });
    assert.equal(key, 'my-test-api-key-12345');
  } finally {
    delete process.env[envVarName];
  }
});

test('resolveApiKey throws when environment variable is not set', () => {
  const envVarName = `CODEOWL_MISSING_KEY_${Date.now()}`;
  delete process.env[envVarName];
  assert.throws(
    () => resolveApiKey({ apiKeyEnvVariable: envVarName }),
    new RegExp(envVarName),
  );
});

// setConfigField
test('setConfigField updates an existing field', () => {
  const tmpDir = makeTmpDir();
  writeConfig(tmpDir, { model: 'anthropic/old-model', exclude: [] });
  setConfigField(tmpDir, 'model', 'anthropic/new-model');

  const content = JSON.parse(
    fs.readFileSync(path.join(tmpDir, '.codeowl', 'config.json'), 'utf-8'),
  );
  assert.equal(content.model, 'anthropic/new-model');
  // Other fields should be preserved
  assert.deepEqual(content.exclude, []);
});

test('setConfigField adds a new field to existing config', () => {
  const tmpDir = makeTmpDir();
  writeConfig(tmpDir, { model: 'anthropic/model' });
  setConfigField(tmpDir, 'exclude', ['dist', 'generated']);

  const content = JSON.parse(
    fs.readFileSync(path.join(tmpDir, '.codeowl', 'config.json'), 'utf-8'),
  );
  assert.deepEqual(content.exclude, ['dist', 'generated']);
  assert.equal(content.model, 'anthropic/model');
});

test('setConfigField works when no config file exists yet', () => {
  const tmpDir = makeTmpDir();
  setConfigField(tmpDir, 'model', 'anthropic/new-model');
  const content = JSON.parse(
    fs.readFileSync(path.join(tmpDir, '.codeowl', 'config.json'), 'utf-8'),
  );
  assert.equal(content.model, 'anthropic/new-model');
});
