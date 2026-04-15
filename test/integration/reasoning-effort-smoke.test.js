/**
 * Smoke test: reasoningEffort threading through the pr-review pipeline.
 *
 * Sets `reasoningEffort: "high"` in `.bateye/config.json` for an OpenAI-style
 * model and runs `pr-review --dry-run` against the mock runtime. Asserts that
 * every agentic planner/reviewer call carries `reasoningEffort: "high"` in
 * the mock runtime log, proving the option threads through the full pipeline.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { commitAll, initGitRepo, runOk, writeJson, writeText } = require('./helpers');

function runPRReview(args, env) {
  return spawnSync('node', ['dist/index.js', 'pr-review', ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    encoding: 'utf-8',
  });
}

test('pr-review passes reasoningEffort: "high" to every runtime call when configured for an openai model', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-reasoning-smoke-'));
  initGitRepo(repoPath);

  // Config: OpenAI-style model with reasoningEffort: "high"
  writeJson(path.join(repoPath, '.bateye', 'config.json'), {
    model: 'openai/gpt-5',
    reasoningEffort: 'high',
    exclude: [],
  });

  // One custom reviewer (no tool, no model override – inherits config.model)
  writeText(path.join(repoPath, '.bateye', 'reviewers', 'security.md'), `---
id: security
name: Security Reviewer
mode: pr-review
category: security
---
Report only concrete security problems after investigating the current repository state.
`);

  // Create base commit + feature branch so the diff is non-empty
  writeText(path.join(repoPath, 'src', 'auth.ts'), `export function verify(token: string) {
  return token.length > 0;
}
`);
  commitAll(repoPath, 'base');
  runOk('git', ['checkout', '-b', 'feature/reasoning-smoke'], { cwd: repoPath });
  writeText(path.join(repoPath, 'src', 'auth.ts'), `export function verify(token: string) {
  return token.trim().length > 0;
}
`);
  commitAll(repoPath, 'trimmed token');

  // Mock runtime fixtures: one planner run + one reviewer agentic run
  const fixturePath = path.join(repoPath, 'mock-runtime.json');
  const logPath = path.join(repoPath, 'mock-runtime-log.json');

  writeJson(fixturePath, {
    runs: [
      // PR planner
      {
        data: {
          intentSummary: 'The PR trims the token before checking its length.',
          selectedReviewers: [
            { reviewerId: 'security', reason: 'Auth change needs security review.', confidence: 0.95 },
          ],
        },
      },
    ],
    agenticRuns: [
      // Security reviewer (agentic run)
      {
        data: {
          score: 80,
          summary: 'Token trimming could lead to bypass with whitespace-only tokens.',
          findings: [
            {
              id: 'SECURITY_1',
              title: 'Whitespace-only tokens pass verification after trim',
              description: 'A token consisting only of whitespace characters passes after trim().length > 0 is replaced by trim().',
              priority: 'high',
              confidence: 0.91,
              filePath: 'src/auth.ts',
              startLine: 2,
              endLine: 2,
              codeQuote: '  return token.trim().length > 0;',
              evidence: ['src/auth.ts verify() now calls trim() before checking length.'],
              verificationTrail: ['file:src/auth.ts'],
              searchedFor: ['trim', 'token'],
              recommendation: 'Reject empty or whitespace-only tokens explicitly before trimming.',
              tags: ['security'],
            },
          ],
        },
      },
    ],
  });

  const result = runPRReview(['--cwd', repoPath, '--base', 'main', '--dry-run'], {
    BATEYE_LLM_MODEL_API_KEY: 'sk-test-smoke-key',
    BATEYE_RUNTIME: 'mock',
    BATEYE_MOCK_RUNTIME_FIXTURES: fixturePath,
    BATEYE_MOCK_RUNTIME_LOG: logPath,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const runtimeLog = JSON.parse(fs.readFileSync(logPath, 'utf-8'));

  const agenticRuns = runtimeLog.filter(e => e.type === 'runAgenticReview');

  assert.equal(agenticRuns.length, 2, 'Expected 1 planner run plus 1 agentic reviewer run');
  const plannerRuns = agenticRuns.filter(entry => entry.callLabel === 'pr-planner');
  const reviewerRuns = agenticRuns.filter(entry => entry.callLabel === 'reviewer:Security Reviewer');
  assert.equal(plannerRuns.length, 1, 'Expected 1 planner run');
  assert.equal(reviewerRuns.length, 1, 'Expected 1 reviewer run');

  // Every run must carry reasoningEffort: "high"
  for (const entry of agenticRuns) {
    assert.equal(
      entry.reasoningEffort,
      'high',
      `agentic run (${entry.callLabel || entry.promptPreview?.slice(0, 40)}) must carry reasoningEffort: "high"`,
    );
  }

  // The pipeline must also build the reasoningOverrides list.
  // Every run should carry at least one override for openai/gpt-5.
  for (const entry of agenticRuns) {
    assert.ok(
      Array.isArray(entry.reasoningOverrides) && entry.reasoningOverrides.length > 0,
      `run (${entry.promptPreview?.slice(0, 40)}) must carry at least one reasoningOverride`,
    );
    const override = entry.reasoningOverrides.find(o => o.model === 'openai/gpt-5');
    assert.ok(override, 'reasoningOverrides must include an entry for openai/gpt-5');
    assert.equal(override.reasoningEffort, 'high');
  }

  // The final report must still contain the single verified finding.
  const reportPath = path.join(repoPath, '.bateye', 'out', 'pr-review.json');
  assert.ok(fs.existsSync(reportPath));
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0].id, 'SECURITY_1');
});

test('conf command writes reasoningEffort into config and reads it back', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-conf-reasoning-'));

  const writeResult = spawnSync(
    'node',
    ['dist/index.js', 'conf', '--cwd', repoPath, '--model', 'openai/gpt-5', '--reasoningEffort', 'high'],
    {
      cwd: process.cwd(),
      env: process.env,
      encoding: 'utf-8',
    },
  );

  assert.equal(writeResult.status, 0, writeResult.stderr || writeResult.stdout);
  assert.match(writeResult.stdout, /Set reasoningEffort = "high"/);

  const config = JSON.parse(fs.readFileSync(path.join(repoPath, '.bateye', 'config.json'), 'utf-8'));
  assert.equal(config.reasoningEffort, 'high');

  // Read back via `conf` command (no args = show current config)
  const readResult = spawnSync('node', ['dist/index.js', 'conf', '--cwd', repoPath], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf-8',
  });

  assert.equal(readResult.status, 0, readResult.stderr || readResult.stdout);
  assert.match(readResult.stdout, /reasoningEffort.*high/);
});
