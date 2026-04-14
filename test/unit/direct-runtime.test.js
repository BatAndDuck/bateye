const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  prepareModel,
  resolveVercelGatewayCredential,
} = require('../../dist/core/runtime/direct/index');
const { createStructuredRuntime, resetRuntime } = require('../../dist/core/runtime/factory');

test('resolveVercelGatewayCredential prefers configured key over .env OIDC token', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-runtime-'));
  fs.writeFileSync(path.join(repoPath, '.env'), 'VERCEL_OIDC_TOKEN=stale-token\n');
  assert.equal(resolveVercelGatewayCredential('sk-api-live-key', repoPath), 'sk-api-live-key');
});

test('resolveVercelGatewayCredential returns undefined when no configured key or .env token exists', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-runtime-empty-'));
  const originalOidcToken = process.env.VERCEL_OIDC_TOKEN;
  const originalGatewayKey = process.env.AI_GATEWAY_API_KEY;
  const originalDefaultKey = process.env.BATEYE_LLM_MODEL_API_KEY;
  delete process.env.VERCEL_OIDC_TOKEN;
  delete process.env.AI_GATEWAY_API_KEY;
  delete process.env.BATEYE_LLM_MODEL_API_KEY;

  try {
    assert.equal(resolveVercelGatewayCredential(undefined, repoPath), undefined);
  } finally {
    if (originalOidcToken === undefined) delete process.env.VERCEL_OIDC_TOKEN;
    else process.env.VERCEL_OIDC_TOKEN = originalOidcToken;

    if (originalGatewayKey === undefined) delete process.env.AI_GATEWAY_API_KEY;
    else process.env.AI_GATEWAY_API_KEY = originalGatewayKey;

    if (originalDefaultKey === undefined) delete process.env.BATEYE_LLM_MODEL_API_KEY;
    else process.env.BATEYE_LLM_MODEL_API_KEY = originalDefaultKey;
  }
});

test('prepareModel rejects unsupported provider prefixes', () => {
  assert.throws(
    () => prepareModel({
      model: 'openrouter/anthropic/claude-sonnet-4-5',
      apiKey: 'test-key',
      systemPrompt: 'Return JSON.',
      userMessage: 'Say ok.',
    }),
    /Model prefix "openrouter" is not supported/,
  );
});

test('prepareModel rejects non-vercel transport overrides that change the provider', () => {
  assert.throws(
    () => prepareModel({
      model: 'anthropic/claude-sonnet-4-5',
      transport: 'openai',
      apiKey: 'test-key',
      systemPrompt: 'Return JSON.',
      userMessage: 'Say ok.',
    }),
    /Only the Vercel transport can override the model provider prefix/,
  );
});

test('prepareModel rejects Vercel transport when the model omits the routed provider prefix', () => {
  assert.throws(
    () => prepareModel({
      model: 'gpt-5.4-nano',
      transport: 'vercel',
      apiKey: 'test-key',
      systemPrompt: 'Return JSON.',
      userMessage: 'Say ok.',
    }),
    /Vercel transport requires a model in provider\/model format/,
  );
});

test('createStructuredRuntime uses mock runtime only when BATEYE_RUNTIME=mock', async () => {
  const originalRuntime = process.env.BATEYE_RUNTIME;

  try {
    process.env.BATEYE_RUNTIME = 'mock';
    resetRuntime();
    const mockRuntime = await createStructuredRuntime();
    assert.equal(mockRuntime.constructor.name, 'MockRuntime');

    delete process.env.BATEYE_RUNTIME;
    resetRuntime();
    const directRuntime = await createStructuredRuntime();
    assert.equal(directRuntime.constructor.name, 'DirectAIRuntime');
  } finally {
    if (originalRuntime === undefined) delete process.env.BATEYE_RUNTIME;
    else process.env.BATEYE_RUNTIME = originalRuntime;
    resetRuntime();
  }
});
