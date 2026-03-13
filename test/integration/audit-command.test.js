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

test('audit command uses built-in reviewers and reaches the mocked runtime', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'codeowl-audit-int-'));
  fs.mkdirSync(path.join(repoPath, '.git'));
  fs.mkdirSync(path.join(repoPath, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repoPath, 'src', 'index.ts'), 'export const value = 1;\n');

  writeJson(path.join(repoPath, '.codeowl', 'config.json'), {
    model: 'anthropic/mock-model',
    exclude: [],
  });

  const fixturePath = path.join(repoPath, 'mock-runtime.json');
  const logPath = path.join(repoPath, 'mock-runtime-log.json');
  const reportPath = path.join(repoPath, 'report.json');
  writeJson(fixturePath, {
    runs: [
      // First call: orchestrator selects the 3 core built-in reviewers
      {
        data: {
          selectedReviewers: [
            { reviewerId: 'code-quality',  reason: 'General code quality' },
            { reviewerId: 'documentation', reason: 'Documentation coverage' },
            { reviewerId: 'security-api',  reason: 'API security' },
          ],
        },
      },
      // Subsequent calls: one per reviewer
      { data: { score: 90, summary: 'solid', findings: [] } },
      { data: { score: 80, summary: 'documented', findings: [] } },
      { data: { score: 70, summary: 'secure enough', findings: [] } },
    ],
  });

  const result = spawnSync('node', ['dist/index.js', 'audit', '--cwd', repoPath, '--output', reportPath], {
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
  assert.ok(fs.existsSync(reportPath));

  const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
  assert.equal(report.command, 'audit');
  assert.equal(report.reviewerResults.length, 3);

  const log = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
  // 1 orchestrator call + 3 reviewer calls = 4 total run() invocations
  assert.equal(log.filter(entry => entry.type === 'run').length, 4);
});
