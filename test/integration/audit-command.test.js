const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { writeJson, writeText } = require('./helpers');

test('audit command uses built-in reviewers and reaches the mocked runtime', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-audit-int-'));
  fs.mkdirSync(path.join(repoPath, '.git'));
  fs.mkdirSync(path.join(repoPath, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repoPath, 'src', 'index.ts'), 'export const value = 1;\n');

  writeJson(path.join(repoPath, '.bateye', 'config.json'), {
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
          intentSummary: 'The repository contains a small TypeScript source tree, so the core built-in audit reviewers are appropriate.',
          selectedReviewers: [
            { reviewerId: 'code-quality',  reason: 'General code quality' , confidence: 0.9 },
            { reviewerId: 'documentation', reason: 'Documentation coverage' , confidence: 0.9 },
            { reviewerId: 'security-api',  reason: 'API security' , confidence: 0.9 },
          ],
        },
      },
    ],
    agenticRuns: [
      { data: { score: 90, summary: 'solid', findings: [] } },
      { data: { score: 80, summary: 'documented', findings: [] } },
      { data: { score: 70, summary: 'secure enough', findings: [] } },
    ],
  });

  const result = spawnSync('node', ['dist/index.js', 'audit', '--cwd', repoPath, '--output', reportPath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BATEYE_LLM_MODEL_API_KEY: 'direct-test-key',
      BATEYE_RUNTIME: 'mock',
      BATEYE_MOCK_RUNTIME_FIXTURES: fixturePath,
      BATEYE_MOCK_RUNTIME_LOG: logPath,
    },
    encoding: 'utf-8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.ok(fs.existsSync(reportPath));

  const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
  assert.equal(report.command, 'audit');
  assert.equal(report.reviewerResults.length, 3);

  const log = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
  assert.equal(log.filter(entry => entry.type === 'run').length, 1);
  assert.equal(log.filter(entry => entry.type === 'runAgenticReview').length, 3);
  assert.equal(log.find(entry => entry.type === 'runAgenticReview').repoPath, repoPath);
});

test('audit command runs a custom tool-backed reviewer end to end', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-audit-tool-int-'));
  fs.mkdirSync(path.join(repoPath, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repoPath, 'src', 'index.ts'), 'export const apiKey = process.env.API_KEY ?? "";\n');

  writeJson(path.join(repoPath, '.bateye', 'config.json'), {
    model: 'anthropic/mock-model',
    exclude: [],
  });

  writeText(path.join(repoPath, '.bateye', 'reviewers', 'audit-tool.md'), `---
id: audit-tool
name: Audit Tool
mode: audit
category: security
tool:
  command: node
  args:
    - scripts/audit-tool.cjs
    - audit-tool-log.json
  targeting: project
  optional: false
---
Focus on scanner-backed security findings only.
`);

  writeText(path.join(repoPath, 'scripts', 'audit-tool.cjs'), `const fs = require('node:fs');
const path = require('node:path');

const logPath = path.join(process.cwd(), process.argv[2]);
fs.writeFileSync(logPath, JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }, null, 2));
process.stdout.write('AUDIT TOOL OK\\nsecret-pattern-detected');
`);

  const fixturePath = path.join(repoPath, 'mock-runtime.json');
  const logPath = path.join(repoPath, 'mock-runtime-log.json');
  const reportPath = path.join(repoPath, 'custom-audit-report.json');
  writeJson(fixturePath, {
    runs: [],
    agenticRuns: [
      {
        data: {
          score: 65,
          summary: 'Scanner output confirms one hard-coded secret risk.',
          findings: [
            {
              id: 'AUDIT_TOOL_1',
              title: 'API key fallback is committed in source',
              description: 'The code reads a production secret directly from process.env without a boundary wrapper.',
              priority: 'high',
              confidence: 0.93,
              filePath: 'src/index.ts',
              startLine: 1,
              endLine: 1,
              evidence: ['process.env.API_KEY'],
              recommendation: 'Move secret access behind configuration validation and inject the resolved value.',
              tags: ['security'],
            },
          ],
        },
      },
    ],
  });

  const result = spawnSync('node', ['dist/index.js', 'audit', '--cwd', repoPath, '--reviewers', 'audit-tool', '--output', reportPath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BATEYE_LLM_MODEL_API_KEY: 'direct-test-key',
      BATEYE_RUNTIME: 'mock',
      BATEYE_MOCK_RUNTIME_FIXTURES: fixturePath,
      BATEYE_MOCK_RUNTIME_LOG: logPath,
    },
    encoding: 'utf-8',
  });
  const combinedOutput = result.stdout + result.stderr;

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.ok(fs.existsSync(reportPath));
  assert.match(combinedOutput, /\[Audit Tool\] Raw findings: 1/);

  const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
  assert.equal(report.command, 'audit');
  assert.equal(report.reviewerResults.length, 1);
  assert.equal(report.reviewerResults[0].reviewerId, 'audit-tool');
  assert.equal(report.reviewerResults[0].execution.toolRan, true);
  assert.match(report.reviewerResults[0].execution.toolOutput, /AUDIT TOOL OK/);

  const toolLog = JSON.parse(fs.readFileSync(path.join(repoPath, 'audit-tool-log.json'), 'utf-8'));
  assert.equal(toolLog.cwd, repoPath);
  assert.deepEqual(toolLog.args, ['audit-tool-log.json']);

  const runtimeLog = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
  assert.equal(runtimeLog.filter(entry => entry.type === 'run').length, 0);
  assert.equal(runtimeLog.filter(entry => entry.type === 'runAgenticReview').length, 1);
  assert.equal(runtimeLog.find(entry => entry.type === 'runAgenticReview').repoPath, repoPath);
});

test('audit command deduplicates overlapping findings across reviewers', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-audit-dedup-int-'));
  fs.mkdirSync(path.join(repoPath, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repoPath, 'src', 'index.ts'), 'export const duplicated = true;\n');

  writeJson(path.join(repoPath, '.bateye', 'config.json'), {
    model: 'anthropic/mock-model',
    exclude: [],
  });

  writeText(path.join(repoPath, '.bateye', 'reviewers', 'dup-a.md'), `---
id: dup-a
name: Duplicate Reviewer A
mode: audit
category: code-quality
---
Look for duplicated code-quality findings only.
`);

  writeText(path.join(repoPath, '.bateye', 'reviewers', 'dup-b.md'), `---
id: dup-b
name: Duplicate Reviewer B
mode: audit
category: code-quality
---
Look for duplicated code-quality findings only.
`);

  const fixturePath = path.join(repoPath, 'mock-runtime.json');
  writeJson(fixturePath, {
    runs: [],
    agenticRuns: [
      {
        data: {
          score: 72,
          summary: 'One issue found.',
          findings: [
            {
              id: 'DUP_A_1',
              title: 'Duplicate constant naming pattern',
              description: 'The duplicated constant name makes the intent harder to follow.',
              priority: 'high',
              confidence: 0.91,
              filePath: 'src/index.ts',
              startLine: 1,
              endLine: 1,
              evidence: ['duplicated = true'],
              recommendation: 'Rename the constant to reflect its purpose.',
              tags: ['maintainability'],
            },
          ],
        },
      },
      {
        data: {
          score: 74,
          summary: 'Same issue described differently.',
          findings: [
            {
              id: 'DUP_B_1',
              title: 'Duplicate constant naming style',
              description: 'The same constant naming choice obscures the code intent.',
              priority: 'medium',
              confidence: 0.84,
              filePath: 'src/index.ts',
              startLine: 1,
              endLine: 1,
              evidence: ['duplicated = true'],
              recommendation: 'Use a clearer constant name.',
              tags: ['maintainability'],
            },
          ],
        },
      },
    ],
  });

  const result = spawnSync('node', ['dist/index.js', 'audit', '--cwd', repoPath, '--reviewers', 'dup-a,dup-b'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BATEYE_LLM_MODEL_API_KEY: 'direct-test-key',
      BATEYE_RUNTIME: 'mock',
      BATEYE_MOCK_RUNTIME_FIXTURES: fixturePath,
    },
    encoding: 'utf-8',
  });
  const combinedOutput = result.stdout + result.stderr;

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(combinedOutput, /\[audit-dedup\] Dropped "Duplicate constant naming style"/);

  const report = JSON.parse(fs.readFileSync(path.join(repoPath, '.bateye', 'out', 'audit.json'), 'utf-8'));
  assert.equal(report.reviewerResults.length, 2);

  const totalFindings = report.reviewerResults.reduce((sum, reviewer) => sum + reviewer.findings.length, 0);
  assert.equal(totalFindings, 1);
  assert.equal(report.reviewerResults.find(reviewer => reviewer.reviewerId === 'dup-a').findings.length, 1);
  assert.equal(report.reviewerResults.find(reviewer => reviewer.reviewerId === 'dup-b').findings.length, 0);
});

test('audit command reports degraded status when review coverage is reduced by tool failures', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-audit-degraded-int-'));
  fs.mkdirSync(path.join(repoPath, '.git'));
  fs.mkdirSync(path.join(repoPath, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repoPath, 'src', 'index.ts'), 'export const value = 1;\n');

  writeJson(path.join(repoPath, '.bateye', 'config.json'), {
    model: 'anthropic/mock-model',
    exclude: [],
  });

  writeText(path.join(repoPath, '.bateye', 'reviewers', 'degraded-tool.md'), `---
id: degraded-tool
name: Degraded Tool Reviewer
mode: audit
category: security
tool:
  command: node
  args:
    - -e
    - process.exit(2)
  targeting: project
  optional: true
---
Investigate security issues only.
`);

  const fixturePath = path.join(repoPath, 'mock-runtime.json');
  writeJson(fixturePath, {
    runs: [],
    agenticRuns: [
      {
        data: {
          score: 88,
          summary: 'No security issues found.',
          findings: [],
        },
      },
    ],
  });

  const result = spawnSync('node', ['dist/index.js', 'audit', '--cwd', repoPath, '--reviewers', 'degraded-tool'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BATEYE_LLM_MODEL_API_KEY: 'direct-test-key',
      BATEYE_RUNTIME: 'mock',
      BATEYE_MOCK_RUNTIME_FIXTURES: fixturePath,
    },
    encoding: 'utf-8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Status:\s+DEGRADED/);
  assert.match(result.stdout, /Review issues/);

  const report = JSON.parse(fs.readFileSync(path.join(repoPath, '.bateye', 'out', 'audit.json'), 'utf-8'));
  assert.equal(report.status, 'degraded');
  assert.equal(report.reviewerResults.length, 1);
  assert.ok(report.issues.some(issue => issue.code === 'audit-reviewer-tool-error'));
});

test('audit command reports degraded status when the orchestrator falls back', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-audit-orchestrator-fallback-'));
  fs.mkdirSync(path.join(repoPath, '.git'));
  fs.mkdirSync(path.join(repoPath, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repoPath, 'src', 'index.ts'), 'export const value = 1;\n');

  writeJson(path.join(repoPath, '.bateye', 'config.json'), {
    model: 'anthropic/mock-model',
    exclude: [],
  });

  const fixturePath = path.join(repoPath, 'mock-runtime.json');
  writeJson(fixturePath, {
    runs: [],
    agenticRuns: [
      { data: { score: 92, summary: 'No API security issues found.', findings: [] } },
      { data: { score: 88, summary: 'No code quality issues found.', findings: [] } },
      { data: { score: 86, summary: 'No documentation issues found.', findings: [] } },
    ],
  });

  const result = spawnSync('node', ['dist/index.js', 'audit', '--cwd', repoPath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BATEYE_LLM_MODEL_API_KEY: 'direct-test-key',
      BATEYE_RUNTIME: 'mock',
      BATEYE_MOCK_RUNTIME_FIXTURES: fixturePath,
    },
    encoding: 'utf-8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Status:\s+DEGRADED/);
  assert.match(result.stdout, /audit reviewer orchestrator failed/i);

  const report = JSON.parse(fs.readFileSync(path.join(repoPath, '.bateye', 'out', 'audit.json'), 'utf-8'));
  assert.equal(report.status, 'degraded');
  assert.ok(report.issues.some(issue => issue.code === 'audit-orchestrator-fallback'));
});

test('audit command prints and persists aggregated token usage', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-audit-tokens-int-'));
  fs.mkdirSync(path.join(repoPath, '.git'));
  fs.mkdirSync(path.join(repoPath, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repoPath, 'src', 'index.ts'), 'export const value = 1;\n');

  writeJson(path.join(repoPath, '.bateye', 'config.json'), {
    model: 'anthropic/mock-model',
    exclude: [],
  });

  const fixturePath = path.join(repoPath, 'mock-runtime.json');
  const reportPath = path.join(repoPath, 'audit-report.json');
  writeJson(fixturePath, {
    runs: [
      {
        data: {
          intentSummary: 'The repository changes are small and should be covered by code-quality and documentation reviewers.',
          selectedReviewers: [
            { reviewerId: 'code-quality', reason: 'General code quality' , confidence: 0.9 },
            { reviewerId: 'documentation', reason: 'Documentation coverage' , confidence: 0.9 },
          ],
        },
        tokensUsed: { inputTokens: 40, outputTokens: 10, estimated: false },
      },
    ],
    agenticRuns: [
      {
        data: { score: 90, summary: 'solid', findings: [] },
        tokensUsed: { inputTokens: 120, outputTokens: 30, estimated: false },
      },
      {
        data: { score: 80, summary: 'documented', findings: [] },
        tokensUsed: { inputTokens: 80, outputTokens: 20, estimated: false },
      },
    ],
  });

  const result = spawnSync('node', ['dist/index.js', 'audit', '--cwd', repoPath, '--output', reportPath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BATEYE_LLM_MODEL_API_KEY: 'direct-test-key',
      BATEYE_RUNTIME: 'mock',
      BATEYE_MOCK_RUNTIME_FIXTURES: fixturePath,
    },
    encoding: 'utf-8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Token usage:\s+300 tokens \(240 in \+ 60 out\) \(actual\)/);

  const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
  assert.deepEqual(report.tokenUsage, {
    inputTokens: 240,
    outputTokens: 60,
    estimated: false,
  });
});

test('audit command fails clearly when non-agentic direct runtime is requested', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-audit-direct-runtime-'));
  fs.mkdirSync(path.join(repoPath, '.git'));
  fs.mkdirSync(path.join(repoPath, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repoPath, 'src', 'index.ts'), 'export const changed = true;\n');

  writeJson(path.join(repoPath, '.bateye', 'config.json'), {
    model: 'anthropic/mock-model',
    exclude: [],
  });

  const result = spawnSync('node', ['dist/index.js', 'audit', '--cwd', repoPath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BATEYE_LLM_MODEL_API_KEY: 'direct-test-key',
      BATEYE_RUNTIME: 'direct',
    },
    encoding: 'utf-8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /Agentic audit cannot use BATEYE_RUNTIME=direct/);
});

test('audit command diagnostic mode writes verifier prompt captures', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-audit-diagnostic-int-'));
  fs.mkdirSync(path.join(repoPath, '.git'));
  fs.mkdirSync(path.join(repoPath, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repoPath, 'src', 'index.ts'), 'export const value = process.env.SECRET ?? "";\n');

  writeJson(path.join(repoPath, '.bateye', 'config.json'), {
    model: 'openai/gpt-5.4-nano',
    exclude: [],
  });

  const fixturePath = path.join(repoPath, 'mock-runtime.json');
  writeJson(fixturePath, {
    runs: [
      {
        data: {
          verifications: [
            { findingId: 'SECURITY_API-001', classification: 'concrete', reason: 'Confirmed by current code.' },
          ],
        },
      },
    ],
    agenticRuns: [
      {
        data: {
          score: 55,
          summary: 'One issue found.',
          findings: [
            {
              id: 'SECURITY_API-001',
              title: 'Environment secret is read directly',
              description: 'The code reads a sensitive environment variable directly.',
              priority: 'high',
              confidence: 0.9,
              filePath: 'src/index.ts',
              startLine: 1,
              endLine: 1,
              evidence: ['process.env.SECRET'],
              recommendation: 'Use validated configuration indirection.',
            },
          ],
        },
      },
    ],
  });

  const result = spawnSync('node', ['dist/index.js', '--diagnostic', '--cwd', repoPath, 'audit', '--reviewers', 'security-api'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BATEYE_LLM_MODEL_API_KEY: 'direct-test-key',
      BATEYE_RUNTIME: 'mock',
      BATEYE_MOCK_RUNTIME_FIXTURES: fixturePath,
    },
    encoding: 'utf-8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Diagnostics enabled\. Writing audit traces to/);

  const diagnosticsDir = path.join(repoPath, '.bateye', 'out', 'diagnostics');
  const files = fs.readdirSync(diagnosticsDir);
  assert.ok(files.some(file => file.includes('audit-verifier-batch1-system')));
  assert.ok(files.some(file => file.includes('audit-verifier-batch1-user')));
});
