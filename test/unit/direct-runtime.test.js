const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { resolveVercelGatewayCredential } = require('../../dist/core/runtime/direct/index');

test('resolveVercelGatewayCredential prefers configured key over .env OIDC token', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'codeowl-runtime-'));
  fs.writeFileSync(path.join(repoPath, '.env'), 'VERCEL_OIDC_TOKEN=stale-token\n');

  const previousCwd = process.cwd();
  try {
    process.chdir(repoPath);
    assert.equal(resolveVercelGatewayCredential('sk-api-live-key'), 'sk-api-live-key');
  } finally {
    process.chdir(previousCwd);
  }
});
