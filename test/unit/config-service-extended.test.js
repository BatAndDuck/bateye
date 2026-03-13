const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  loadConfig,
  saveConfig,
  resolveConfig,
  resolveAuthEnvName,
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

test('resolveConfig uses default transport when absent', () => {
  const tmpDir = makeTmpDir();
  const config = resolveConfig(tmpDir);
  assert.equal(config.transport, 'auto');
});

test('resolveConfig uses config model when specified', () => {
  const tmpDir = makeTmpDir();
  writeConfig(tmpDir, { model: 'anthropic/claude-opus-4' });
  const config = resolveConfig(tmpDir);
  assert.equal(config.model, 'anthropic/claude-opus-4');
});

test('resolveConfig uses config transport and apiBaseUrl when specified', () => {
  const tmpDir = makeTmpDir();
  writeConfig(tmpDir, {
    transport: 'vercel',
    apiBaseUrl: 'https://ai-gateway.vercel.sh/v1',
  });
  const config = resolveConfig(tmpDir);
  assert.equal(config.transport, 'vercel');
  assert.equal(config.apiBaseUrl, 'https://ai-gateway.vercel.sh/v1');
});

test('resolveConfig returns empty exclude array when absent', () => {
  const tmpDir = makeTmpDir();
  const config = resolveConfig(tmpDir);
  assert.deepEqual(config.exclude, []);
});

// resolveApiKey
test('resolveApiKey returns API key from default environment variable', () => {
  const originalKey = process.env.CODE_OWL_LLM_MODEL_API_KEY;
  process.env.CODE_OWL_LLM_MODEL_API_KEY = 'my-test-api-key-12345';
  try {
    const key = resolveApiKey();
    assert.equal(key, 'my-test-api-key-12345');
  } finally {
    if (originalKey === undefined) {
      delete process.env.CODE_OWL_LLM_MODEL_API_KEY;
    } else {
      process.env.CODE_OWL_LLM_MODEL_API_KEY = originalKey;
    }
  }
});

test('resolveApiKey uses VERCEL_OIDC_TOKEN for Vercel models', () => {
  const originalDefaultKey = process.env.CODE_OWL_LLM_MODEL_API_KEY;
  const originalGatewayKey = process.env.AI_GATEWAY_API_KEY;
  const originalToken = process.env.VERCEL_OIDC_TOKEN;
  delete process.env.CODE_OWL_LLM_MODEL_API_KEY;
  delete process.env.AI_GATEWAY_API_KEY;
  process.env.VERCEL_OIDC_TOKEN = 'vercel-oidc-token';
  try {
    const key = resolveApiKey({ model: 'vercel/minimax/minimax-m2.5', transport: 'auto' });
    assert.equal(key, 'vercel-oidc-token');
  } finally {
    if (originalDefaultKey === undefined) {
      delete process.env.CODE_OWL_LLM_MODEL_API_KEY;
    } else {
      process.env.CODE_OWL_LLM_MODEL_API_KEY = originalDefaultKey;
    }
    if (originalGatewayKey === undefined) {
      delete process.env.AI_GATEWAY_API_KEY;
    } else {
      process.env.AI_GATEWAY_API_KEY = originalGatewayKey;
    }
    if (originalToken === undefined) {
      delete process.env.VERCEL_OIDC_TOKEN;
    } else {
      process.env.VERCEL_OIDC_TOKEN = originalToken;
    }
  }
});

test('resolveAuthEnvName returns VERCEL_OIDC_TOKEN for Vercel transport', () => {
  assert.equal(
    resolveAuthEnvName({ model: 'anthropic/claude-sonnet-4-5', transport: 'vercel' }),
    'VERCEL_OIDC_TOKEN',
  );
});

test('resolveApiKey throws when required environment variable is not set', () => {
  delete process.env.CODE_OWL_LLM_MODEL_API_KEY;
  assert.throws(
    () => resolveApiKey(),
    /CODE_OWL_LLM_MODEL_API_KEY/,
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

test('setConfigField supports transport fields', () => {
  const tmpDir = makeTmpDir();
  writeConfig(tmpDir, { model: 'anthropic/model' });
  setConfigField(tmpDir, 'transport', 'vercel');
  setConfigField(tmpDir, 'apiBaseUrl', 'https://ai-gateway.vercel.sh/v1');

  const content = JSON.parse(
    fs.readFileSync(path.join(tmpDir, '.codeowl', 'config.json'), 'utf-8'),
  );
  assert.equal(content.transport, 'vercel');
  assert.equal(content.apiBaseUrl, 'https://ai-gateway.vercel.sh/v1');
});

test('setConfigField works when no config file exists yet', () => {
  const tmpDir = makeTmpDir();
  setConfigField(tmpDir, 'model', 'anthropic/new-model');
  const content = JSON.parse(
    fs.readFileSync(path.join(tmpDir, '.codeowl', 'config.json'), 'utf-8'),
  );
  assert.equal(content.model, 'anthropic/new-model');
});

test('setConfigField rejects non-array values for exclude', () => {
  const tmpDir = makeTmpDir();
  assert.throws(
    () => setConfigField(tmpDir, 'exclude', 'dist'),
    /must be an array of non-empty strings/,
  );
});

test('setConfigField rejects blank exclude entries', () => {
  const tmpDir = makeTmpDir();
  assert.throws(
    () => setConfigField(tmpDir, 'exclude', ['dist', '']),
    /must contain only non-empty strings/,
  );
});

test('setConfigField supports disabledReviewers arrays', () => {
  const tmpDir = makeTmpDir();
  setConfigField(tmpDir, 'disabledReviewers', ['inline-docs', 'i18n']);

  const content = JSON.parse(
    fs.readFileSync(path.join(tmpDir, '.codeowl', 'config.json'), 'utf-8'),
  );
  assert.deepEqual(content.disabledReviewers, ['inline-docs', 'i18n']);
});
