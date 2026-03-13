const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  resolveSystemDesignTemplatePath,
  runSystemDesign,
} = require('../../dist/features/system-design/application/system-design-service');

test('resolveSystemDesignTemplatePath returns a feature-owned asset', () => {
  const templatePath = resolveSystemDesignTemplatePath();
  assert.ok(fs.existsSync(templatePath));
  assert.match(templatePath, /features[\\/]system-design[\\/]assets[\\/]index\.html$/);
});

test('runSystemDesign produces static outputs without an API key', async () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'codeowl-system-design-'));
  const outputDir = path.join(repoPath, '.codeowl', 'out', 'system-design-test');

  fs.mkdirSync(path.join(repoPath, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repoPath, 'src', 'index.ts'), 'export function main() { return "ok"; }\n');

  const originalApiKey = process.env.CODE_OWL_LLM_MODEL_API_KEY;
  const originalOidc = process.env.VERCEL_OIDC_TOKEN;
  const originalGatewayKey = process.env.AI_GATEWAY_API_KEY;
  delete process.env.CODE_OWL_LLM_MODEL_API_KEY;
  delete process.env.VERCEL_OIDC_TOKEN;
  delete process.env.AI_GATEWAY_API_KEY;

  try {
    const result = await runSystemDesign(
      { repoPath, outputDir },
      {
        getRuntime: async () => {
          throw new Error('runtime should not be requested for static analysis');
        },
      },
    );

    assert.equal(result.command, 'system-design');
    assert.ok(result.services.length >= 1);
    assert.equal(result.artifacts.htmlReportPath, path.join(outputDir, 'index.html'));
    assert.ok(fs.existsSync(path.join(outputDir, 'index.html')));
    assert.ok(fs.existsSync(path.join(outputDir, 'graph.json')));
    assert.ok(fs.existsSync(path.join(outputDir, 'inventory.json')));
  } finally {
    if (originalApiKey === undefined) delete process.env.CODE_OWL_LLM_MODEL_API_KEY;
    else process.env.CODE_OWL_LLM_MODEL_API_KEY = originalApiKey;

    if (originalOidc === undefined) delete process.env.VERCEL_OIDC_TOKEN;
    else process.env.VERCEL_OIDC_TOKEN = originalOidc;

    if (originalGatewayKey === undefined) delete process.env.AI_GATEWAY_API_KEY;
    else process.env.AI_GATEWAY_API_KEY = originalGatewayKey;
  }
});
