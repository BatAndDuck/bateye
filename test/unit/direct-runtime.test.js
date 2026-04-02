const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { resolveVercelGatewayCredential } = require('../../dist/core/runtime/direct/index');
const { resolveOpenCodeModelTarget } = require('../../dist/core/runtime/provider-routing');
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

test('resolveOpenCodeModelTarget routes explicit apiBaseUrl through the OpenAI-compatible provider', () => {
  assert.deepEqual(
    resolveOpenCodeModelTarget('anthropic/claude-sonnet-4-5', 'auto', 'https://litellm.example/v1'),
    {
      transport: 'openai',
      modelId: 'anthropic/claude-sonnet-4-5',
    }
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
