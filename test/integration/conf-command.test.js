const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('conf command stores the model in repo config and the API key in the BatEye credential store', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-conf-int-'));
  const credentialsPath = path.join(repoPath, 'credentials.json');

  const result = spawnSync(
    'node',
    ['dist/index.js', 'conf', '--cwd', repoPath, '--model', 'openai/gpt-5.4-nano', '--apikey', 'sk-test-123456'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BATEYE_CREDENTIALS_FILE: credentialsPath,
      },
      encoding: 'utf-8',
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Set model = "openai\/gpt-5\.4-nano"/);
  assert.match(result.stdout, /Stored API key \*\*\*3456/);

  const config = JSON.parse(fs.readFileSync(path.join(repoPath, '.bateye', 'config.json'), 'utf-8'));
  assert.equal(config.model, 'openai/gpt-5.4-nano');

  const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));
  assert.equal(credentials.repos[path.resolve(repoPath)].apiKey, 'sk-test-123456');
});
