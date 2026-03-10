const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

test('system-design command reaches the mocked runtime and writes artifacts', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'codeowl-system-design-int-'));
  fs.mkdirSync(path.join(repoPath, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repoPath, 'src', 'index.ts'), 'export function main() { return true; }\n');

  writeJson(path.join(repoPath, '.codeowl', 'config.json'), {
    model: 'anthropic/mock-model',
    apiKeyEnvVariable: 'CODE_OWL_LLM_MODEL_API_KEY',
    exclude: [],
  });

  const fixturePath = path.join(repoPath, 'mock-runtime.json');
  const logPath = path.join(repoPath, 'mock-runtime-log.json');
  writeJson(fixturePath, {
    runs: [
      {
        data: {
          serviceId: 'sample-app',
          name: 'sample-app',
          kind: 'app',
          purpose: 'Sample feature app',
          responsibilities: ['Serve requests'],
          publicInterfaces: [],
          dependencies: [],
          entities: [],
          submodules: ['routes', 'handlers'],
          complexityScore: 4,
          risks: [],
        },
      },
      {
        data: {
          architectureType: 'modular-monolith',
          score: 82,
          strengths: ['Clear separation'],
          weaknesses: ['Needs more docs'],
          globalSummary: 'Single app organized into modules.',
        },
      },
    ],
  });

  const result = spawnSync('node', ['dist/index.js', 'system-design', '--cwd', repoPath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CODE_OWL_LLM_MODEL_API_KEY: 'direct-test-key',
      CODEOWL_RUNTIME: 'mock',
      CODEOWL_MOCK_RUNTIME_FIXTURES: fixturePath,
      CODEOWL_MOCK_RUNTIME_LOG: logPath,
    },
    encoding: 'utf-8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const outDir = path.join(repoPath, '.codeowl', 'out', 'system-design');
  assert.ok(fs.existsSync(path.join(outDir, 'index.html')));
  assert.ok(fs.existsSync(path.join(outDir, 'graph.json')));
  assert.ok(fs.existsSync(path.join(outDir, 'summary.json')));

  const summary = JSON.parse(fs.readFileSync(path.join(outDir, 'summary.json'), 'utf-8'));
  assert.equal(summary.architectureType, 'modular-monolith');

  const log = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
  assert.equal(log.filter(entry => entry.type === 'run').length, 2);
});
