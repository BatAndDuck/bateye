const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  redactSensitiveText,
  resolveArtifactsDir,
  validateResult,
} = require('../../scripts/provider-smoke-test.js');

test('resolveArtifactsDir rejects absolute paths and workspace escapes', () => {
  assert.throws(() => resolveArtifactsDir('..'), /Artifact directory must stay within/);
  assert.throws(() => resolveArtifactsDir(path.join(process.cwd(), 'tmp')), /only accepts relative artifact directories/i);
});

test('resolveArtifactsDir accepts report/provider-smoke descendants', () => {
  const resolved = resolveArtifactsDir('report/provider-smoke/openai');
  assert.ok(resolved.endsWith(path.join('report', 'provider-smoke', 'openai')));
});

test('redactSensitiveText masks secret-like environment values', () => {
  const text = 'failed with sk-secret-123 and Bearer token-secret-456';
  const redacted = redactSensitiveText(text, {
    BATEYE_LLM_MODEL_API_KEY: 'sk-secret-123',
    AI_GATEWAY_API_KEY: 'token-secret-456',
  });

  assert.equal(redacted.includes('sk-secret-123'), false);
  assert.equal(redacted.includes('token-secret-456'), false);
  assert.match(redacted, /\[REDACTED\]/);
});

test('validateResult throws a clear error for null JSON', () => {
  assert.throws(() => validateResult(null), /not a JSON object/);
});
