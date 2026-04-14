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
  resolveGitHubToken,
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

function writeLocalConfig(repoPath, data) {
  const configDir = path.join(repoPath, '.bateye');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'config.local.json'), JSON.stringify(data, null, 2));
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

test('loadConfig merges config.local.json over config.json', () => {
  const tmpDir = makeTmpDir();
  writeConfig(tmpDir, {
    model: 'anthropic/shared-model',
    exclude: ['dist'],
    prReview: {
      maxReviewers: 5,
    },
  });
  writeLocalConfig(tmpDir, {
    model: 'openai/local-model',
    prReview: {
      autoApprove: {
        enabled: false,
      },
    },
  });

  const config = loadConfig(tmpDir);
  assert.equal(config.model, 'openai/local-model');
  assert.deepEqual(config.exclude, ['dist']);
  assert.deepEqual(config.prReview, {
    maxReviewers: 5,
    autoApprove: {
      enabled: false,
    },
  });
});

test('loadConfig throws on malformed JSON', () => {
  const tmpDir = makeTmpDir();
  fs.mkdirSync(path.join(tmpDir, '.bateye'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, '.bateye', 'config.json'), '{ invalid json }');
  assert.throws(() => loadConfig(tmpDir), /Failed to parse/);
});

test('loadConfig throws on malformed local config JSON', () => {
  const tmpDir = makeTmpDir();
  writeConfig(tmpDir, { model: 'anthropic/shared-model' });
  fs.writeFileSync(path.join(tmpDir, '.bateye', 'config.local.json'), '{ invalid json }');
  assert.throws(() => loadConfig(tmpDir), /config\.local\.json/);
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
    apiBaseUrl: 'https://ai-gateway.vercel.sh/v3/ai',
  });
  const config = resolveConfig(tmpDir);
  assert.equal(config.transport, 'vercel');
  assert.equal(config.apiBaseUrl, 'https://ai-gateway.vercel.sh/v3/ai');
});

test('resolveConfig gives local config priority for matching fields', () => {
  const tmpDir = makeTmpDir();
  writeConfig(tmpDir, {
    model: 'anthropic/shared-model',
    transport: 'auto',
    exclude: ['dist'],
  });
  writeLocalConfig(tmpDir, {
    model: 'openai/local-model',
    transport: 'vercel',
    exclude: ['dist', 'generated'],
  });

  const config = resolveConfig(tmpDir);
  assert.equal(config.model, 'openai/local-model');
  assert.equal(config.transport, 'vercel');
  assert.deepEqual(config.exclude, ['dist', 'generated']);
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

test('resolveApiKey prefers config apiKey over environment and credential store', withCredentialStore(storePath => {
  const repoPath = makeTmpDir();
  const original = process.env.BATEYE_LLM_MODEL_API_KEY;
  process.env.BATEYE_LLM_MODEL_API_KEY = 'env-key-12345';
  writeLocalConfig(repoPath, { apiKey: 'config-key-67890' });
  saveRepoApiKey(repoPath, 'stored-key-24680', storePath);

  try {
    assert.equal(resolveApiKey(resolveConfig(repoPath), repoPath), 'config-key-67890');
  } finally {
    if (original === undefined) delete process.env.BATEYE_LLM_MODEL_API_KEY;
    else process.env.BATEYE_LLM_MODEL_API_KEY = original;
  }
}));

test('resolveApiKey uses VERCEL_OIDC_TOKEN for Vercel-routed supported models', () => {
  const originalDefaultKey = process.env.BATEYE_LLM_MODEL_API_KEY;
  const originalGatewayKey = process.env.AI_GATEWAY_API_KEY;
  const originalToken = process.env.VERCEL_OIDC_TOKEN;
  delete process.env.BATEYE_LLM_MODEL_API_KEY;
  delete process.env.AI_GATEWAY_API_KEY;
  process.env.VERCEL_OIDC_TOKEN = 'vercel-oidc-token';
  try {
    const key = resolveApiKey({ model: 'vercel/openai/gpt-5.4-nano', transport: 'auto' });
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

test('resolveGitHubToken prefers explicit token, then config, then env', () => {
  const original = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = 'env-github-token';

  try {
    assert.equal(
      resolveGitHubToken({ githubToken: 'config-github-token' }, 'explicit-github-token'),
      'explicit-github-token',
    );
    assert.equal(
      resolveGitHubToken({ githubToken: 'config-github-token' }),
      'config-github-token',
    );
    assert.equal(
      resolveGitHubToken(undefined),
      'env-github-token',
    );
  } finally {
    if (original === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = original;
  }
});

test('resolveGitHubToken ignores blank config placeholders', () => {
  const original = process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_TOKEN;

  try {
    assert.equal(resolveGitHubToken({ githubToken: '   ' }), undefined);
  } finally {
    if (original === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = original;
  }
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

test('saveRepoApiKey removes a stale lock only when its owner process is no longer alive', withCredentialStore(storePath => {
  const repoPath = makeTmpDir();
  const lockPath = `${storePath}.lock`;
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify({
    pid: 999999,
    token: 'dead-process-lock',
    createdAt: new Date(0).toISOString(),
  }), 'utf-8');
  const staleDate = new Date(Date.now() - 60_000);
  fs.utimesSync(lockPath, staleDate, staleDate);

  saveRepoApiKey(repoPath, 'stale-lock-key-86420', storePath);

  assert.equal(resolveStoredApiKey(repoPath, storePath), 'stale-lock-key-86420');
  assert.equal(fs.existsSync(lockPath), false);
}));

test('saveRepoApiKey does not remove a stale-looking lock owned by a live process', withCredentialStore(storePath => {
  const repoPath = makeTmpDir();
  const lockPath = `${storePath}.lock`;
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify({
    pid: process.pid,
    token: 'live-process-lock',
    createdAt: new Date(0).toISOString(),
  }), 'utf-8');
  const staleDate = new Date(Date.now() - 60_000);
  fs.utimesSync(lockPath, staleDate, staleDate);

  assert.throws(
    () => saveRepoApiKey(repoPath, 'should-timeout', storePath),
    /Timed out waiting for BatEye credential store lock/,
  );
  assert.equal(fs.existsSync(lockPath), true);

  fs.rmSync(lockPath, { force: true });
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
  setConfigField(tmpDir, 'apiBaseUrl', 'https://ai-gateway.vercel.sh/v3/ai');

  const content = JSON.parse(
    fs.readFileSync(path.join(tmpDir, '.bateye', 'config.json'), 'utf-8'),
  );
  assert.equal(content.transport, 'vercel');
  assert.equal(content.apiBaseUrl, 'https://ai-gateway.vercel.sh/v3/ai');
});

test('setConfigField works when no config file exists yet', () => {
  const tmpDir = makeTmpDir();
  setConfigField(tmpDir, 'model', 'anthropic/new-model');
  const content = JSON.parse(
    fs.readFileSync(path.join(tmpDir, '.bateye', 'config.json'), 'utf-8'),
  );
  assert.equal(content.model, 'anthropic/new-model');
});

test('setConfigField updates config.json without copying local overrides into it', () => {
  const tmpDir = makeTmpDir();
  writeConfig(tmpDir, { model: 'anthropic/shared-model' });
  writeLocalConfig(tmpDir, { transport: 'vercel' });

  setConfigField(tmpDir, 'apiBaseUrl', 'https://gateway.example/v1');

  const sharedConfig = JSON.parse(
    fs.readFileSync(path.join(tmpDir, '.bateye', 'config.json'), 'utf-8'),
  );
  assert.deepEqual(sharedConfig, {
    model: 'anthropic/shared-model',
    apiBaseUrl: 'https://gateway.example/v1',
  });

  const effectiveConfig = resolveConfig(tmpDir);
  assert.equal(effectiveConfig.transport, 'vercel');
  assert.equal(effectiveConfig.apiBaseUrl, 'https://gateway.example/v1');
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
