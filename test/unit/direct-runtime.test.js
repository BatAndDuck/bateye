const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { resolveVercelGatewayCredential } = require('../../dist/core/runtime/direct/index');

test('resolveVercelGatewayCredential prefers configured key over .env OIDC token', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'codeowl-runtime-'));
  fs.writeFileSync(path.join(repoPath, '.env'), 'VERCEL_OIDC_TOKEN=stale-token\n');
  assert.equal(resolveVercelGatewayCredential('sk-api-live-key', repoPath), 'sk-api-live-key');
});

test('resolveVercelGatewayCredential returns undefined when no configured key or .env token exists', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'codeowl-runtime-empty-'));
  const originalOidcToken = process.env.VERCEL_OIDC_TOKEN;
  const originalGatewayKey = process.env.AI_GATEWAY_API_KEY;
  const originalDefaultKey = process.env.CODE_OWL_LLM_MODEL_API_KEY;
  delete process.env.VERCEL_OIDC_TOKEN;
  delete process.env.AI_GATEWAY_API_KEY;
  delete process.env.CODE_OWL_LLM_MODEL_API_KEY;

  try {
    assert.equal(resolveVercelGatewayCredential(undefined, repoPath), undefined);
  } finally {
    if (originalOidcToken === undefined) delete process.env.VERCEL_OIDC_TOKEN;
    else process.env.VERCEL_OIDC_TOKEN = originalOidcToken;

    if (originalGatewayKey === undefined) delete process.env.AI_GATEWAY_API_KEY;
    else process.env.AI_GATEWAY_API_KEY = originalGatewayKey;

    if (originalDefaultKey === undefined) delete process.env.CODE_OWL_LLM_MODEL_API_KEY;
    else process.env.CODE_OWL_LLM_MODEL_API_KEY = originalDefaultKey;
  }
});
