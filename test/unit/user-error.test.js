const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

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

test('briefError prefers Codebite failure artifact detail over generic auth categorization', () => {
  const { briefError } = require('../../dist/core/output/user-error');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-user-error-artifact-'));
  const summaryPath = path.join(tempDir, 'pr-planner.codebite.failure.summary.json');

  fs.writeFileSync(summaryPath, JSON.stringify({
    error: {
      message: 'Codebite worker process failed before producing a response',
    },
    worker: {
      stderrPreview: 'ERR_MODULE_NOT_FOUND: Cannot find package \"codebite\" imported from worker runtime',
    },
  }, null, 2), 'utf-8');

  const error = new Error('outer error');
  error.codebiteArtifactPaths = [summaryPath];

  const message = briefError(error);
  assert.match(message, /Codebite worker failed: ERR_MODULE_NOT_FOUND/);
  assert.doesNotMatch(message, /API key rejected by provider/i);
});
