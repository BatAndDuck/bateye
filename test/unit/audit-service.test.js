const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { runAudit } = require('../../dist/features/audit/application/audit-service');

function makeRepo() {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'codeowl-audit-unit-'));
  fs.mkdirSync(path.join(repoPath, '.git'));
  fs.mkdirSync(path.join(repoPath, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repoPath, 'src', 'index.ts'), 'export const value = 1;\n');
  fs.mkdirSync(path.join(repoPath, '.codeowl'), { recursive: true });
  fs.writeFileSync(
    path.join(repoPath, '.codeowl', 'config.json'),
    JSON.stringify({ model: 'anthropic/mock-model' }, null, 2),
  );
  return repoPath;
}

test('runAudit throws when a reviewer runtime call fails', async () => {
  const repoPath = makeRepo();
  process.env.CODE_OWL_LLM_MODEL_API_KEY = 'test-api-key';

  try {
    await assert.rejects(
      () => runAudit(
        { repoPath },
        {
          getRuntime: async () => ({
            async run() {
              throw new Error('401 Error verifying OIDC token');
            },
            async listModels() {
              return [];
            },
            async isAvailable() {
              return true;
            },
          }),
        },
      ),
      /Reviewer code-quality failed: 401 Error verifying OIDC token/,
    );
  } finally {
    delete process.env.CODE_OWL_LLM_MODEL_API_KEY;
  }
});
