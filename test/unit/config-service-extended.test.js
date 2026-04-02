const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
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
const {
  resolveStoredApiKey,
  saveRepoApiKey,
} = require('../../dist/features/config/application/credential-store');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-cfg-'));
}

function writeConfig(repoPath, data) {
  const configDir = path.join(repoPath, '.bateye');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify(data, null, 2));
}

function withCredentialStore(testFn) {
  return async () => {
    const original = process.env.BATEYE_CREDENTIALS_FILE;
    const storePath = path.join(makeTmpDir(), 'credentials.json');
    process.env.BATEYE_CREDENTIALS_FILE = storePath;
    try {
      await testFn(storePath);
    } finally {
      if (original === undefined) delete process.env.BATEYE_CREDENTIALS_FILE;
      else process.env.BATEYE_CREDENTIALS_FILE = original;
    }
  };
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
  fs.mkdirSync(path.join(tmpDir, '.bateye'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, '.bateye', 'config.json'), '{ invalid json }');
  assert.throws(() => loadConfig(tmpDir), /Failed to parse/);
});

// saveConfig
test('saveConfig writes config as formatted JSON with trailing newline', () => {
  const tmpDir = makeTmpDir();
  saveConfig(tmpDir, { model: 'anthropic/claude-3', exclude: ['dist'] });

  const content = fs.readFileSync(path.join(tmpDir, '.bateye', 'config.json'), 'utf-8');
  assert.ok(content.endsWith('\n'));

  const parsed = JSON.parse(content);
  assert.equal(parsed.model, 'anthropic/claude-3');
  assert.deepEqual(parsed.exclude, ['dist']);
});

test('saveConfig creates .bateye directory if it does not exist', () => {
  const tmpDir = makeTmpDir();
  assert.ok(!fs.existsSync(path.join(tmpDir, '.bateye')));
  saveConfig(tmpDir, { model: 'anthropic/test' });
  assert.ok(fs.existsSync(path.join(tmpDir, '.bateye', 'config.json')));
});

test('saveConfig overwrites existing config', () => {
  const tmpDir = makeTmpDir();
  saveConfig(tmpDir, { model: 'anthropic/old-model' });
  saveConfig(tmpDir, { model: 'anthropic/new-model' });
  const content = JSON.parse(
    fs.readFileSync(path.join(tmpDir, '.bateye', 'config.json'), 'utf-8'),
  );
  assert.equal(content.model, 'anthropic/new-model');
});

// resolveConfig
test('resolveConfig uses default model when model is absent', () => {
  const tmpDir = makeTmpDir();
  const config = resolveConfig(tmpDir);
  assert.ok(config.model.startsWith('anthropic/') || config.model.startsWith('vercel/'));
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
  const originalKey = process.env.BATEYE_LLM_MODEL_API_KEY;
  process.env.BATEYE_LLM_MODEL_API_KEY = 'my-test-api-key-12345';
  try {
    const key = resolveApiKey();
    assert.equal(key, 'my-test-api-key-12345');
  } finally {
    if (originalKey === undefined) {
      delete process.env.BATEYE_LLM_MODEL_API_KEY;
    } else {
      process.env.BATEYE_LLM_MODEL_API_KEY = originalKey;
    }
  }
});

test('resolveApiKey uses VERCEL_OIDC_TOKEN for Vercel models', () => {
  const originalDefaultKey = process.env.BATEYE_LLM_MODEL_API_KEY;
  const originalGatewayKey = process.env.AI_GATEWAY_API_KEY;
  const originalToken = process.env.VERCEL_OIDC_TOKEN;
  delete process.env.BATEYE_LLM_MODEL_API_KEY;
  delete process.env.AI_GATEWAY_API_KEY;
  process.env.VERCEL_OIDC_TOKEN = 'vercel-oidc-token';
  try {
    const key = resolveApiKey({ model: 'vercel/minimax/minimax-m2.5', transport: 'auto' });
    assert.equal(key, 'vercel-oidc-token');
  } finally {
    if (originalDefaultKey === undefined) {
      delete process.env.BATEYE_LLM_MODEL_API_KEY;
    } else {
      process.env.BATEYE_LLM_MODEL_API_KEY = originalDefaultKey;
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

test('resolveApiKey throws when required environment variable is not set', withCredentialStore(() => {
  const repoPath = makeTmpDir();
  const original = process.env.BATEYE_LLM_MODEL_API_KEY;
  const originalGatewayKey = process.env.AI_GATEWAY_API_KEY;
  const originalToken = process.env.VERCEL_OIDC_TOKEN;
  delete process.env.BATEYE_LLM_MODEL_API_KEY;
  delete process.env.AI_GATEWAY_API_KEY;
  delete process.env.VERCEL_OIDC_TOKEN;
  try {
    assert.throws(
      () => resolveApiKey({ model: 'openai/gpt-5.4-nano', transport: 'auto' }, repoPath),
      /BATEYE_LLM_MODEL_API_KEY|AI_GATEWAY_API_KEY|VERCEL_OIDC_TOKEN/,
    );
  } finally {
    if (original === undefined) delete process.env.BATEYE_LLM_MODEL_API_KEY;
    else process.env.BATEYE_LLM_MODEL_API_KEY = original;
    if (originalGatewayKey === undefined) delete process.env.AI_GATEWAY_API_KEY;
    else process.env.AI_GATEWAY_API_KEY = originalGatewayKey;
    if (originalToken === undefined) delete process.env.VERCEL_OIDC_TOKEN;
    else process.env.VERCEL_OIDC_TOKEN = originalToken;
  }
}));

test('saveRepoApiKey stores a repo-scoped credential outside the repository config', withCredentialStore(storePath => {
  const repoPath = makeTmpDir();
  saveRepoApiKey(repoPath, 'stored-key-12345', storePath);

  assert.equal(resolveStoredApiKey(repoPath, storePath), 'stored-key-12345');
  const persisted = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
  assert.equal(persisted.repos[path.resolve(repoPath)].apiKey, 'stored-key-12345');
}));

test('saveRepoApiKey writes credential store with restrictive permissions on POSIX', withCredentialStore(storePath => {
  if (process.platform === 'win32') {
    return;
  }

  const repoPath = makeTmpDir();
  saveRepoApiKey(repoPath, 'stored-key-12345', storePath);

  const fileMode = fs.statSync(storePath).mode & 0o777;
  const dirMode = fs.statSync(path.dirname(storePath)).mode & 0o777;
  assert.equal(fileMode, 0o600);
  assert.equal(dirMode, 0o700);
}));

test('resolveApiKey falls back to the BatEye credential store when env vars are absent', withCredentialStore(storePath => {
  const repoPath = makeTmpDir();
  const original = process.env.BATEYE_LLM_MODEL_API_KEY;
  delete process.env.BATEYE_LLM_MODEL_API_KEY;
  saveRepoApiKey(repoPath, 'stored-key-67890', storePath);

  try {
    assert.equal(resolveApiKey({ model: 'openai/gpt-5.4-nano', transport: 'auto' }, repoPath), 'stored-key-67890');
  } finally {
    if (original === undefined) delete process.env.BATEYE_LLM_MODEL_API_KEY;
    else process.env.BATEYE_LLM_MODEL_API_KEY = original;
  }
}));

test('resolveStoredApiKey ignores malformed credential entries', withCredentialStore(storePath => {
  const repoPath = makeTmpDir();
  const otherRepoPath = makeTmpDir();
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify({
    repos: {
      [path.resolve(repoPath)]: {
        apiKey: '',
        updatedAt: '2026-04-02T00:00:00.000Z',
      },
      [path.resolve(otherRepoPath)]: {
        apiKey: 'stored-key-24680',
        updatedAt: '2026-04-02T00:00:00.000Z',
      },
    },
  }, null, 2));

  assert.equal(resolveStoredApiKey(repoPath, storePath), undefined);
  assert.equal(resolveStoredApiKey(otherRepoPath, storePath), 'stored-key-24680');
}));

test('saveRepoApiKey waits for a lock held by another process and still persists the credential', withCredentialStore(async storePath => {
  const repoPath = makeTmpDir();
  const lockPath = `${storePath}.lock`;
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(lockPath, String(process.pid), 'utf-8');

  const script = `
    const { saveRepoApiKey, resolveStoredApiKey } = require(${JSON.stringify(path.resolve(process.cwd(), 'dist/features/config/application/credential-store'))});
    const [storePath, repoPath] = process.argv.slice(1);
    saveRepoApiKey(repoPath, 'locked-key-13579', storePath);
    process.stdout.write(resolveStoredApiKey(repoPath, storePath) || '');
  `;

  const child = spawn(process.execPath, ['-e', script, storePath, repoPath], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', chunk => {
    stderr += chunk.toString();
  });

  await new Promise(resolve => setTimeout(resolve, 150));
  fs.rmSync(lockPath, { force: true });

  const exitCode = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });

  assert.equal(exitCode, 0, stderr);
  assert.equal(stdout.trim(), 'locked-key-13579');
  assert.equal(resolveStoredApiKey(repoPath, storePath), 'locked-key-13579');
}));

// setConfigField
test('setConfigField updates an existing field', () => {
  const tmpDir = makeTmpDir();
  writeConfig(tmpDir, { model: 'anthropic/old-model', exclude: [] });
  setConfigField(tmpDir, 'model', 'anthropic/new-model');

  const content = JSON.parse(
    fs.readFileSync(path.join(tmpDir, '.bateye', 'config.json'), 'utf-8'),
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
    fs.readFileSync(path.join(tmpDir, '.bateye', 'config.json'), 'utf-8'),
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
    fs.readFileSync(path.join(tmpDir, '.bateye', 'config.json'), 'utf-8'),
  );
  assert.equal(content.transport, 'vercel');
  assert.equal(content.apiBaseUrl, 'https://ai-gateway.vercel.sh/v1');
});

test('setConfigField works when no config file exists yet', () => {
  const tmpDir = makeTmpDir();
  setConfigField(tmpDir, 'model', 'anthropic/new-model');
  const content = JSON.parse(
    fs.readFileSync(path.join(tmpDir, '.bateye', 'config.json'), 'utf-8'),
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
    fs.readFileSync(path.join(tmpDir, '.bateye', 'config.json'), 'utf-8'),
  );
  assert.deepEqual(content.disabledReviewers, ['inline-docs', 'i18n']);
});
