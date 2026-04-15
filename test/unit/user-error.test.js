const test = require('node:test');
const assert = require('node:assert/strict');

test('categorizeError keeps generic Codebite worker crashes out of the auth bucket', () => {
  const { categorizeError } = require('../../dist/core/output/user-error');

  const diagnosis = categorizeError(
    'Codebite agentic review failed for vercel/openai/gpt-5.4-nano: '
    + 'Command failed with exit code 1: /opt/hostedtoolcache/node/20.19.0/x64/bin/node '
    + '<- Codebite worker process failed before producing a response (exitCode=1; stderr: file URL import failed)',
  );

  assert.equal(diagnosis.category, 'unknown');
  assert.doesNotMatch(diagnosis.brief, /API key rejected by provider/i);
});

test('categorizeError still recognizes explicit gateway credential rejections as auth failures', () => {
  const { categorizeError } = require('../../dist/core/output/user-error');

  const diagnosis = categorizeError(
    'Codebite agentic review failed for vercel/openai/gpt-5.4-nano: '
    + 'Vercel AI Gateway rejected the configured bearer token for inference. '
    + 'Use an AI Gateway API key created in Vercel AI Gateway, or provide VERCEL_OIDC_TOKEN.',
  );

  assert.equal(diagnosis.category, 'auth');
  assert.match(diagnosis.brief, /API key rejected by provider/i);
});
