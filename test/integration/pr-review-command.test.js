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
    env: {
      ...process.env,
      ...env,
    },
    encoding: 'utf-8',
  });
}

test('pr-review command runs agentic reviewers, semantically verifies findings, and writes the final report', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-pr-review-int-'));
  initGitRepo(repoPath);

  writeJson(path.join(repoPath, '.bateye', 'config.json'), {
    model: 'anthropic/mock-model',
    exclude: [],
  });

  writeText(path.join(repoPath, '.bateye', 'reviewers', 'pr-tool.md'), `---
id: pr-tool
name: PR Tool Reviewer
mode: pr-review
category: security
tool:
  command: node
  args:
    - scripts/pr-tool.cjs
    - pr-tool-log.json
  targeting: file
  fileArgs: true
  optional: false
---
Report only concrete security problems after investigating the current repository state.
`);

  writeText(path.join(repoPath, '.bateye', 'reviewers', 'pr-follow-up.md'), `---
id: pr-follow-up
name: PR Follow-up Reviewer
mode: pr-review
category: code-quality
---
Report only concrete code quality problems after investigating the current repository state.
`);

  writeText(path.join(repoPath, 'scripts', 'pr-tool.cjs'), `const fs = require('node:fs');
const path = require('node:path');

const [, , logFile, ...files] = process.argv;
const logPath = path.join(process.cwd(), logFile);
fs.writeFileSync(logPath, JSON.stringify({ files }, null, 2));
process.stdout.write('PR TOOL OK\\n' + files.join('\\n'));
`);

  writeText(path.join(repoPath, 'src', 'service.ts'), `export function buildMessage(name: string) {
  return name.trim();
}
`);
  commitAll(repoPath, 'base');

  runOk('git', ['checkout', '-b', 'feature/pr-review'], { cwd: repoPath });

  writeText(path.join(repoPath, 'src', 'service.ts'), `export function buildMessage(name: string) {
  const normalized = name.trim();
  return normalized;
}
`);
  commitAll(repoPath, 'feature change');

  const fixturePath = path.join(repoPath, 'mock-runtime.json');
  const logPath = path.join(repoPath, 'mock-runtime-log.json');
  writeJson(fixturePath, {
    runs: [
      {
        data: {
          intentSummary: 'The PR refactors normalization flow intentionally and should be checked by security and follow-up reviewers.',
          selectedReviewers: [
            { reviewerId: 'pr-tool', reason: 'Changed TypeScript logic needs a security scan.' , confidence: 0.9 },
            { reviewerId: 'pr-follow-up', reason: 'The updated function should get a code quality pass.' , confidence: 0.9 },
          ],
        },
      },
      {
        data: {
          verifications: [
            {
              findingId: 'PR_TOOL_PR_1',
              supported: true,
              classification: 'direct',
              reason: 'The finding is supported by the current file content and anchored to changed code.',
            },
            {
              findingId: 'PR_FOLLOW_UP_PR_2',
              supported: false,
              classification: 'unrelated',
              reason: 'The anchor file is not part of the PR diff, so the finding is not related to the reviewed changes.',
            },
          ],
        },
      },
    ],
    agenticRuns: [
      {
        data: {
          score: 70,
          summary: 'One concrete issue found in the new normalization flow.',
          findings: [
            {
              id: 'PR_TOOL_PR_1',
              title: 'Normalized input is returned without escaping',
              description: 'The current file returns the trimmed user input directly from the changed line.',
              priority: 'high',
              confidence: 0.94,
              filePath: 'src/service.ts',
              startLine: 2,
              endLine: 2,
              codeQuote: '  const normalized = name.trim();',
              evidence: ['src/service.ts returns the normalized input directly from the changed block.'],
              verificationTrail: ['file:src/service.ts', 'search:normalized'],
              searchedFor: ['escaping', 'validation'],
              recommendation: 'Escape or validate the normalized value before returning it.',
              tags: ['security'],
            },
          ],
        },
      },
      {
        data: {
          score: 68,
          summary: 'One duplicate issue and one invalid issue were surfaced.',
          findings: [
            {
              id: 'PR_FOLLOW_UP_PR_1',
              title: 'Trimmed value still flows straight to the return path',
              description: 'The current file returns the normalized input without any additional validation.',
              priority: 'high',
              confidence: 0.9,
              filePath: 'src/service.ts',
              startLine: 2,
              endLine: 2,
              codeQuote: '  const normalized = name.trim();',
              evidence: ['src/service.ts returns the normalized input immediately after assigning it.'],
              verificationTrail: ['file:src/service.ts', 'search:return normalized'],
              searchedFor: ['validation'],
              recommendation: 'Introduce validation before the value reaches the return statement.',
              tags: ['code-quality'],
            },
            {
              id: 'PR_FOLLOW_UP_PR_2',
              title: 'Reviewer referenced a file outside the diff',
              description: 'This intentionally invalid finding should be rejected by deterministic verification.',
              priority: 'medium',
              confidence: 0.88,
              filePath: 'src/other.ts',
              startLine: 1,
              endLine: 1,
              codeQuote: 'export const missing = true;',
              evidence: ['src/other.ts is outside the diff.'],
              verificationTrail: ['file:src/other.ts'],
              searchedFor: ['src/other.ts'],
              recommendation: 'Ignore this finding because it is outside the diff.',
              tags: ['test'],
            },
          ],
        },
      },
    ],
  });

  const result = runPRReview(['--cwd', repoPath, '--base', 'main', '--dry-run'], {
    BATEYE_LLM_MODEL_API_KEY: 'direct-test-key',
    BATEYE_RUNTIME: 'mock',
    BATEYE_MOCK_RUNTIME_FIXTURES: fixturePath,
    BATEYE_MOCK_RUNTIME_LOG: logPath,
  });
  const combinedOutput = result.stdout + result.stderr;

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const reportPath = path.join(repoPath, '.bateye', 'out', 'pr-review.json');
  assert.ok(fs.existsSync(reportPath));

  const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
  assert.equal(report.command, 'pr-review');
  assert.equal(report.baseRef, 'main');
  assert.equal(report.headRef, 'HEAD');
  assert.equal(report.selectedReviewers.length, 2);
  assert.equal(report.findings.length, 1);
  assert.equal(report.rejectedFindings, 1);
  assert.deepEqual(report.verificationStats, {
    rawFindings: 3,
    confidenceRejected: 0,
    deterministicRejected: 0,
    diffGateRejected: 1,
    semanticRejected: 0,
    finalFindings: 1,
  });
  assert.match(report.summary, /Verification/);
  assert.match(report.summary, /Raw findings \| 3/);
  assert.match(report.summary, /Rejected \(deterministic\) \| 0/);
  assert.match(combinedOutput, /Raw findings detail: 3/);
  assert.match(combinedOutput, /Reviewer referenced a file outside the diff/);

  const finding = report.findings[0];
  assert.equal(finding.filePath, 'src/service.ts');
  assert.equal(finding.startLine, 2);
  assert.deepEqual(finding.verificationTrail, ['file:src/service.ts', 'search:normalized']);
  assert.deepEqual(finding.searchedFor, ['escaping', 'validation']);
  assert.match(finding.reviewerId, /pr-tool/);
  assert.match(finding.reviewerId, /pr-follow-up/);

  const toolLog = JSON.parse(fs.readFileSync(path.join(repoPath, 'pr-tool-log.json'), 'utf-8'));
  assert.deepEqual(toolLog.files, ['src/service.ts']);

  const runtimeLog = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
  // Two non-agentic runs: the orchestrator and semantic verification.
  assert.equal(runtimeLog.filter(entry => entry.type === 'run').length, 2);
  assert.equal(runtimeLog.filter(entry => entry.type === 'runAgenticReview').length, 2);
  assert.equal(runtimeLog.find(entry => entry.type === 'runAgenticReview').repoPath, repoPath);
});

test('pr-review command fails when there are no changed files between the requested refs', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-pr-review-empty-int-'));
  initGitRepo(repoPath);

  writeJson(path.join(repoPath, '.bateye', 'config.json'), {
    model: 'anthropic/mock-model',
    exclude: [],
  });

  writeText(path.join(repoPath, 'src', 'service.ts'), 'export const stable = true;\n');
  commitAll(repoPath, 'base');

  const fixturePath = path.join(repoPath, 'mock-runtime.json');
  writeJson(fixturePath, { runs: [], agenticRuns: [] });

  const result = runPRReview(['--cwd', repoPath, '--base', 'HEAD', '--head', 'HEAD', '--dry-run'], {
    BATEYE_LLM_MODEL_API_KEY: 'direct-test-key',
    BATEYE_RUNTIME: 'mock',
    BATEYE_MOCK_RUNTIME_FIXTURES: fixturePath,
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /No changed files found between the specified refs/);
  assert.equal(fs.existsSync(path.join(repoPath, '.bateye', 'out', 'pr-review.json')), false);
});

test('pr-review command uses exactly the reviewers the orchestrator selected, no more', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-pr-review-broad-coverage-'));
  initGitRepo(repoPath);

  writeJson(path.join(repoPath, '.bateye', 'config.json'), {
    model: 'anthropic/mock-model',
    exclude: [],
  });

  writeText(path.join(repoPath, 'src', 'index.ts'), `export function formatName(name: string) {
  return name.trim();
}
`);
  commitAll(repoPath, 'base');

  runOk('git', ['checkout', '-b', 'feature/wider-review'], { cwd: repoPath });
  writeText(path.join(repoPath, 'src', 'index.ts'), `export function formatName(name: string) {
  const normalized = name.trim();
  return normalized.toUpperCase();
}
`);
  commitAll(repoPath, 'feature change');

  const fixturePath = path.join(repoPath, 'mock-runtime.json');
  const logPath = path.join(repoPath, 'mock-runtime-log.json');
  writeJson(fixturePath, {
    runs: [
      {
        data: {
          intentSummary: 'The PR changes a single TypeScript function, so a bug-focused reviewer is sufficient.',
          selectedReviewers: [
            { reviewerId: 'bug-hunter', reason: 'Changed TypeScript logic should get a bug pass.' , confidence: 0.9 },
          ],
        },
      },
    ],
    agenticRuns: [
      { data: { score: 92, summary: 'No bug issues found.', findings: [] } },
    ],
  });

  const result = runPRReview(['--cwd', repoPath, '--base', 'main', '--dry-run'], {
    BATEYE_LLM_MODEL_API_KEY: 'direct-test-key',
    BATEYE_RUNTIME: 'mock',
    BATEYE_MOCK_RUNTIME_FIXTURES: fixturePath,
    BATEYE_MOCK_RUNTIME_LOG: logPath,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const report = JSON.parse(fs.readFileSync(path.join(repoPath, '.bateye', 'out', 'pr-review.json'), 'utf-8'));
  const selectedIds = report.selectedReviewers.map(reviewer => reviewer.reviewerId);
  assert.deepEqual(selectedIds, ['bug-hunter']);

  const runtimeLog = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
  assert.equal(runtimeLog.filter(entry => entry.type === 'runAgenticReview').length, 1);
});

test('pr-review command runs all reviewers the orchestrator selected without filtering', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-pr-review-stable-selection-'));
  initGitRepo(repoPath);

  writeJson(path.join(repoPath, '.bateye', 'config.json'), {
    model: 'anthropic/mock-model',
    exclude: [],
  });

  writeText(path.join(repoPath, 'src', 'runtime.ts'), `export async function fetchWithLogs(url: string) {
  console.log('fetching', url);
  return fetch(url);
}
`);
  commitAll(repoPath, 'base');

  runOk('git', ['checkout', '-b', 'feature/stable-selection'], { cwd: repoPath });
  writeText(path.join(repoPath, 'src', 'runtime.ts'), `export async function fetchWithLogs(url: string) {
  console.log('fetching', url);
  const response = await fetch(url);
  return response;
}
`);
  commitAll(repoPath, 'feature change');

  const fixturePath = path.join(repoPath, 'mock-runtime.json');
  writeJson(fixturePath, {
    runs: [
      {
        data: {
          intentSummary: 'The PR updates runtime behavior and logging, so the full set of selected reviewers should run.',
          selectedReviewers: [
            { reviewerId: 'error-handling', reason: 'Error path changed.' , confidence: 0.9 },
            { reviewerId: 'log-reviewer', reason: 'Logging changed.' , confidence: 0.9 },
            { reviewerId: 'complexity', reason: 'Complexity changed.' , confidence: 0.9 },
            { reviewerId: 'code-quality', reason: 'General code quality.' , confidence: 0.9 },
            { reviewerId: 'clean-code', reason: 'Readability changed.' , confidence: 0.9 },
            { reviewerId: 'test-quality', reason: 'Tests may need review.' , confidence: 0.9 },
            { reviewerId: 'resiliency', reason: 'Network call changed.' , confidence: 0.9 },
            { reviewerId: 'bug-hunter', reason: 'Logic changed.' , confidence: 0.9 },
          ],
        },
      },
    ],
    agenticRuns: [
      { data: { score: 95, summary: 'ok', findings: [] } },
      { data: { score: 95, summary: 'ok', findings: [] } },
      { data: { score: 95, summary: 'ok', findings: [] } },
      { data: { score: 95, summary: 'ok', findings: [] } },
      { data: { score: 95, summary: 'ok', findings: [] } },
      { data: { score: 95, summary: 'ok', findings: [] } },
      { data: { score: 95, summary: 'ok', findings: [] } },
      { data: { score: 95, summary: 'ok', findings: [] } },
    ],
  });

  const result = runPRReview(['--cwd', repoPath, '--base', 'main', '--dry-run'], {
    BATEYE_LLM_MODEL_API_KEY: 'direct-test-key',
    BATEYE_RUNTIME: 'mock',
    BATEYE_MOCK_RUNTIME_FIXTURES: fixturePath,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const report = JSON.parse(fs.readFileSync(path.join(repoPath, '.bateye', 'out', 'pr-review.json'), 'utf-8'));
  const selectedIds = report.selectedReviewers.map(reviewer => reviewer.reviewerId);
  assert.deepEqual(selectedIds, ['error-handling', 'log-reviewer', 'complexity', 'code-quality', 'clean-code', 'test-quality', 'resiliency', 'bug-hunter']);
});

test('pr-review command reports degraded status when review coverage is reduced by tool failures', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-pr-review-degraded-'));
  initGitRepo(repoPath);

  writeJson(path.join(repoPath, '.bateye', 'config.json'), {
    model: 'anthropic/mock-model',
    exclude: [],
  });

  writeText(path.join(repoPath, '.bateye', 'reviewers', 'failing-tool-reviewer.md'), `---
id: failing-tool-reviewer
name: Failing Tool Reviewer
mode: pr-review
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

  writeText(path.join(repoPath, '.bateye', 'reviewers', 'plain-reviewer.md'), `---
id: plain-reviewer
name: Plain Reviewer
mode: pr-review
category: code-quality
---
Investigate code quality issues only.
`);

  writeText(path.join(repoPath, 'src', 'index.ts'), `export const value = 1;
`);
  commitAll(repoPath, 'base');

  runOk('git', ['checkout', '-b', 'feature/degraded-review'], { cwd: repoPath });
  writeText(path.join(repoPath, 'src', 'index.ts'), `export const value = 2;
`);
  commitAll(repoPath, 'feature change');

  const fixturePath = path.join(repoPath, 'mock-runtime.json');
  writeJson(fixturePath, {
    runs: [
      {
        data: {
          intentSummary: 'The PR changes a single exported value, so both selected reviewers should inspect the same diff.',
          selectedReviewers: [
            { reviewerId: 'failing-tool-reviewer', reason: 'Security pass.' , confidence: 0.9 },
            { reviewerId: 'plain-reviewer', reason: 'Code quality pass.' , confidence: 0.9 },
          ],
        },
      },
    ],
    agenticRuns: [
      { data: { score: 90, summary: 'No security findings.', findings: [] } },
      { data: { score: 92, summary: 'No code quality findings.', findings: [] } },
    ],
  });

  const result = runPRReview(['--cwd', repoPath, '--base', 'main', '--dry-run'], {
    BATEYE_LLM_MODEL_API_KEY: 'direct-test-key',
    BATEYE_RUNTIME: 'mock',
    BATEYE_MOCK_RUNTIME_FIXTURES: fixturePath,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Status:\s+DEGRADED/);
  assert.match(result.stdout, /Review issues/);

  const report = JSON.parse(fs.readFileSync(path.join(repoPath, '.bateye', 'out', 'pr-review.json'), 'utf-8'));
  assert.equal(report.status, 'degraded');
  assert.equal(report.findings.length, 0);
  assert.ok(report.issues.some(issue => issue.code === 'pr-reviewer-optional-tool-failed'));
  assert.match(report.summary, /Review completed with warnings/);
});

test('pr-review command rejects false positives when current code preserves the behavior elsewhere in the file', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-pr-review-inline-fp-'));
  initGitRepo(repoPath);

  writeJson(path.join(repoPath, '.bateye', 'config.json'), {
    model: 'anthropic/mock-model',
    exclude: [],
  });

  writeText(path.join(repoPath, '.bateye', 'reviewers', 'bug-hunter-local.md'), `---
id: bug-hunter-local
name: Bug Hunter Local
mode: pr-review
category: qa
---
Report only concrete bug regressions that still exist in the current repository state.
`);

  writeText(path.join(repoPath, 'src', 'index.ts'), `function buildExcludePatterns(config) {
  return ['dist', ...(config.exclude || [])];
}

export function buildRepoIndex(config) {
  const excludePatterns = buildExcludePatterns(config);
  return excludePatterns;
}
`);
  commitAll(repoPath, 'base');

  runOk('git', ['checkout', '-b', 'feature/inline-helper'], { cwd: repoPath });
  writeText(path.join(repoPath, 'src', 'index.ts'), `export function buildRepoIndex(config) {
  const excludePatterns = ['dist', ...(config.exclude || [])];
  return excludePatterns;
}
`);
  commitAll(repoPath, 'feature change');

  const fixturePath = path.join(repoPath, 'mock-runtime.json');
  writeJson(fixturePath, {
    runs: [
      {
        data: {
          intentSummary: 'The helper was inlined intentionally, so reviewers should verify whether config.exclude handling still exists before reporting a regression.',
          selectedReviewers: [
            { reviewerId: 'bug-hunter-local', reason: 'Potential logic regression in config handling.' , confidence: 0.9 },
          ],
        },
      },
      {
        data: {
          verifications: [
            {
              findingId: 'BUG_HUNTER_LOCAL_1',
              supported: false,
              classification: 'unclear',
              reason: 'The current file still applies config.exclude inline, so the claimed regression does not exist.',
            },
          ],
        },
      },
    ],
    agenticRuns: [
      {
        data: {
          score: 55,
          summary: 'One possible regression found.',
          findings: [
            {
              id: 'BUG_HUNTER_LOCAL_1',
              title: 'Removed helper breaks config exclude handling',
              description: 'The helper removal looks like it drops config.exclude support from the current implementation.',
              priority: 'high',
              confidence: 0.88,
              filePath: 'src/index.ts',
              startLine: 2,
              endLine: 2,
              codeQuote: '  const excludePatterns = [\'dist\', ...(config.exclude || [])];',
              evidence: ['The helper call was removed from src/index.ts.'],
              verificationTrail: ['file:src/index.ts', 'search:config.exclude'],
              searchedFor: ['buildExcludePatterns', 'config.exclude'],
              recommendation: 'Restore the helper or otherwise preserve config.exclude handling.',
              tags: ['logic'],
            },
          ],
        },
      },
    ],
  });

  const result = runPRReview(['--cwd', repoPath, '--base', 'main', '--dry-run'], {
    BATEYE_LLM_MODEL_API_KEY: 'direct-test-key',
    BATEYE_RUNTIME: 'mock',
    BATEYE_MOCK_RUNTIME_FIXTURES: fixturePath,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const report = JSON.parse(fs.readFileSync(path.join(repoPath, '.bateye', 'out', 'pr-review.json'), 'utf-8'));
  assert.equal(report.findings.length, 0);
  assert.deepEqual(report.verificationStats, {
    rawFindings: 1,
    confidenceRejected: 0,
    deterministicRejected: 0,
    diffGateRejected: 0,
    semanticRejected: 1,
    finalFindings: 0,
  });
});

test('pr-review command rejects workflow absence claims when the current workflow already contains the gate', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-pr-review-workflow-fp-'));
  initGitRepo(repoPath);

  writeJson(path.join(repoPath, '.bateye', 'config.json'), {
    model: 'anthropic/mock-model',
    exclude: [],
  });

  writeText(path.join(repoPath, '.bateye', 'reviewers', 'ci-cd-local.md'), `---
id: ci-cd-local
name: CI Local
mode: pr-review
category: devex
---
Report only concrete CI/CD issues confirmed in the current workflow files.
`);

  writeText(path.join(repoPath, '.github', 'workflows', 'ci.yml'), `name: CI
on: [pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm test
`);
  commitAll(repoPath, 'base');

  runOk('git', ['checkout', '-b', 'feature/workflow-change'], { cwd: repoPath });
  writeText(path.join(repoPath, '.github', 'workflows', 'ci.yml'), `name: CI
on: [pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm test
`);
  commitAll(repoPath, 'feature change');

  const fixturePath = path.join(repoPath, 'mock-runtime.json');
  writeJson(fixturePath, {
    runs: [
      {
        data: {
          intentSummary: 'The workflow change intentionally adds linting, so reviewers should inspect the current workflow before claiming any missing gates.',
          selectedReviewers: [
            { reviewerId: 'ci-cd-local', reason: 'Workflow file changed.' , confidence: 0.9 },
          ],
        },
      },
      {
        data: {
          verifications: [
            {
              findingId: 'CI_CD_LOCAL_1',
              supported: false,
              classification: 'unclear',
              reason: 'The current workflow still configures npm cache in actions/setup-node.',
            },
          ],
        },
      },
    ],
    agenticRuns: [
      {
        data: {
          score: 61,
          summary: 'One medium severity issue reported.',
          findings: [
            {
              id: 'CI_CD_LOCAL_1',
              title: 'Workflow no longer caches npm dependencies',
              description: 'The workflow appears to run npm ci without dependency caching.',
              priority: 'medium',
              confidence: 0.84,
              filePath: '.github/workflows/ci.yml',
              startLine: 11,
              endLine: 11,
              codeQuote: '      - run: npm ci',
              evidence: ['npm ci runs in the workflow.'],
              verificationTrail: ['file:.github/workflows/ci.yml', 'search:cache: \'npm\''],
              searchedFor: ['cache: \'npm\''],
              recommendation: 'Add npm dependency caching to the workflow.',
              tags: ['ci'],
            },
          ],
        },
      },
    ],
  });

  const result = runPRReview(['--cwd', repoPath, '--base', 'main', '--dry-run'], {
    BATEYE_LLM_MODEL_API_KEY: 'direct-test-key',
    BATEYE_RUNTIME: 'mock',
    BATEYE_MOCK_RUNTIME_FIXTURES: fixturePath,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const report = JSON.parse(fs.readFileSync(path.join(repoPath, '.bateye', 'out', 'pr-review.json'), 'utf-8'));
  assert.equal(report.findings.length, 0);
  assert.equal(report.verificationStats.semanticRejected, 1);
});

test('pr-review command rejects findings anchored only to removed code', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-pr-review-removed-code-'));
  initGitRepo(repoPath);

  writeJson(path.join(repoPath, '.bateye', 'config.json'), {
    model: 'anthropic/mock-model',
    exclude: [],
  });

  writeText(path.join(repoPath, '.bateye', 'reviewers', 'removed-code-reviewer.md'), `---
id: removed-code-reviewer
name: Removed Code Reviewer
mode: pr-review
category: code-quality
---
Report only concrete issues that still exist after investigating the current file.
`);

  writeText(path.join(repoPath, 'src', 'index.ts'), `export function buildValue() {
  const legacy = unsafeCall();
  return legacy;
}
`);
  commitAll(repoPath, 'base');

  runOk('git', ['checkout', '-b', 'feature/remove-legacy'], { cwd: repoPath });
  writeText(path.join(repoPath, 'src', 'index.ts'), `export function buildValue() {
  const current = safeCall();
  return current;
}
`);
  commitAll(repoPath, 'feature change');

  const fixturePath = path.join(repoPath, 'mock-runtime.json');
  writeJson(fixturePath, {
    runs: [
      {
        data: {
          intentSummary: 'The legacy unsafe call was intentionally removed, so reviewers must validate findings against the current file state.',
          selectedReviewers: [
            { reviewerId: 'removed-code-reviewer', reason: 'Changed function body.' , confidence: 0.9 },
          ],
        },
      },
      {
        data: {
          verifications: [
            {
              findingId: 'REMOVED_CODE_REVIEWER_1',
              supported: false,
              classification: 'unrelated',
              reason: 'The quoted code only exists in removed lines, so the finding does not describe a current PR defect.',
            },
          ],
        },
      },
    ],
    agenticRuns: [
      {
        data: {
          score: 58,
          summary: 'One issue reported from removed code.',
          findings: [
            {
              id: 'REMOVED_CODE_REVIEWER_1',
              title: 'Legacy unsafe call remains in the function',
              description: 'The function still uses the legacy unsafe call.',
              priority: 'medium',
              confidence: 0.86,
              filePath: 'src/index.ts',
              startLine: 2,
              endLine: 2,
              codeQuote: '  const legacy = unsafeCall();',
              evidence: ['legacy call still present'],
              verificationTrail: ['file:src/index.ts'],
              searchedFor: ['unsafeCall'],
              recommendation: 'Replace the legacy call with the safe implementation.',
              tags: ['correctness'],
            },
          ],
        },
      },
    ],
  });

  const result = runPRReview(['--cwd', repoPath, '--base', 'main', '--dry-run'], {
    BATEYE_LLM_MODEL_API_KEY: 'direct-test-key',
    BATEYE_RUNTIME: 'mock',
    BATEYE_MOCK_RUNTIME_FIXTURES: fixturePath,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const report = JSON.parse(fs.readFileSync(path.join(repoPath, '.bateye', 'out', 'pr-review.json'), 'utf-8'));
  assert.equal(report.findings.length, 0);
  assert.deepEqual(report.verificationStats, {
    rawFindings: 1,
    confidenceRejected: 0,
    deterministicRejected: 0,
    diffGateRejected: 0,
    semanticRejected: 1,
    finalFindings: 0,
  });
});

test('pr-review command in github mode filters already-posted findings and updates mocked GitHub state', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-pr-review-github-int-'));
  initGitRepo(repoPath);

  writeJson(path.join(repoPath, '.bateye', 'config.json'), {
    model: 'anthropic/mock-model',
    exclude: [],
    prReview: {
      autoApprove: {
        enabled: true,
        maxSeverity: 'low',
      },
    },
  });

  writeText(path.join(repoPath, '.bateye', 'reviewers', 'github-reviewer.md'), `---
id: github-reviewer
name: GitHub Reviewer
mode: pr-review
category: code-quality
---
Report only concrete code quality findings after investigating the current repository state.
`);

  writeText(path.join(repoPath, 'src', 'service.ts'), `export function buildMessage(name: string) {
  return name.trim();
}
`);
  commitAll(repoPath, 'base');

  runOk('git', ['checkout', '-b', 'feature/github-review'], { cwd: repoPath });
  writeText(path.join(repoPath, 'src', 'service.ts'), `export function buildMessage(name: string) {
  const normalized = name.trim();
  return normalized;
}
`);
  commitAll(repoPath, 'feature change');

  const fixturePath = path.join(repoPath, 'mock-runtime.json');
  writeJson(fixturePath, {
    runs: [
      {
        data: {
          intentSummary: 'The PR updates one TypeScript function and should be reviewed by the GitHub reviewer only.',
          selectedReviewers: [
            { reviewerId: 'github-reviewer', reason: 'Updated TypeScript code should be reviewed.' , confidence: 0.9 },
          ],
        },
      },
      {
        data: {
          verifications: [
            {
              findingId: 'GITHUB_REVIEWER_1',
              supported: true,
              classification: 'direct',
              reason: 'The low-severity issue is supported by the current file content.',
            },
          ],
        },
      },
    ],
    agenticRuns: [
      {
        data: {
          score: 92,
          summary: 'Only one low-severity issue found, but it matches an existing comment.',
          findings: [
            {
              id: 'GITHUB_REVIEWER_1',
              title: 'Trimmed input is returned directly',
              description: 'The current file shows the normalized user input flowing straight to the return statement.',
              priority: 'low',
              confidence: 0.95,
              filePath: 'src/service.ts',
              startLine: 2,
              endLine: 2,
              codeQuote: '  const normalized = name.trim();',
              evidence: ['src/service.ts returns the normalized input directly.'],
              verificationTrail: ['file:src/service.ts', 'search:return normalized'],
              searchedFor: ['validation'],
              recommendation: 'Validate the normalized value before returning it.',
              tags: ['code-quality'],
            },
          ],
        },
      },
    ],
  });

  const octokitFixturePath = path.join(repoPath, 'octokit-state.json');
  writeJson(octokitFixturePath, {
    pullRequest: {
      baseRef: 'main',
      baseSha: 'base-sha',
      headRef: 'feature/github-review',
      headSha: 'head-sha',
    },
    issueComments: [
      {
        id: 10,
        body: '<!-- bateye-status -->\nOld status body',
        user: { login: 'bateye-bot' },
        created_at: '2026-03-15T00:00:00Z',
      },
      {
        id: 11,
        body: '<!-- bateye-summary -->\nOld summary body',
        user: { login: 'bateye-bot' },
        created_at: '2026-03-15T00:00:00Z',
      },
    ],
    reviewComments: [
      {
        id: 21,
        body: '🟢 **[BatEye LOW] Trimmed input is returned directly**\n\nAlready posted.',
        path: 'src/service.ts',
        line: 2,
        user: { login: 'bateye-bot' },
        created_at: '2026-03-15T00:00:00Z',
      },
    ],
    actions: [],
  });

  const hookPath = path.join(process.cwd(), 'test', 'integration', 'mock-octokit-hook.cjs');
  const result = spawnSync('node', ['--require', hookPath, 'dist/index.js', 'pr-review', '--cwd', repoPath, '--base', 'main', '--github', '--pr-number', '7'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BATEYE_LLM_MODEL_API_KEY: 'direct-test-key',
      BATEYE_RUNTIME: 'mock',
      BATEYE_MOCK_RUNTIME_FIXTURES: fixturePath,
      BATEYE_OCTOKIT_FIXTURES: octokitFixturePath,
      GITHUB_TOKEN: 'github-test-token',
      GITHUB_REPOSITORY: 'BatEyeOrg/BatEye',
      PR_NUMBER: '7',
      COMMENT_ID: '99',
    },
    encoding: 'utf-8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const report = JSON.parse(fs.readFileSync(path.join(repoPath, '.bateye', 'out', 'pr-review.json'), 'utf-8'));
  assert.equal(report.findings.length, 0);
  assert.equal(report.autoApproved, true);
  assert.match(report.summary, /No issues found/);
  assert.deepEqual(report.verificationStats, {
    rawFindings: 1,
    confidenceRejected: 0,
    deterministicRejected: 0,
    diffGateRejected: 0,
    semanticRejected: 0,
    finalFindings: 0,
  });

  const octokitState = JSON.parse(fs.readFileSync(octokitFixturePath, 'utf-8'));
  const actionTypes = octokitState.actions.map(action => action.type);
  assert.deepEqual(actionTypes, ['createReaction', 'updateComment', 'updateComment', 'updateComment', 'createReview']);
  assert.equal(actionTypes.includes('createReviewComment'), false);

  const updatedStatus = octokitState.issueComments.find(comment => comment.id === 10);
  const updatedSummary = octokitState.issueComments.find(comment => comment.id === 11);
  assert.match(updatedStatus.body, /0 findings posted/);
  assert.match(updatedSummary.body, /No issues found/);
});

test('pr-review command falls back to a general PR comment when an inline line cannot be resolved', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-pr-review-inline-fallback-'));
  initGitRepo(repoPath);

  writeJson(path.join(repoPath, '.bateye', 'config.json'), {
    model: 'anthropic/mock-model',
    exclude: [],
  });

  writeText(path.join(repoPath, '.bateye', 'reviewers', 'github-inline-reviewer.md'), `---
id: github-inline-reviewer
name: GitHub Inline Reviewer
mode: pr-review
category: code-quality
---
Report only concrete findings anchored to the changed file.
`);

  writeText(path.join(repoPath, 'src', 'service.ts'), `export function buildMessage(name: string) {
  return name.trim();
}
`);
  commitAll(repoPath, 'base');

  runOk('git', ['checkout', '-b', 'feature/github-inline-fallback'], { cwd: repoPath });
  writeText(path.join(repoPath, 'src', 'service.ts'), `export function buildMessage(name: string) {
  const normalized = name.trim();
  return normalized;
}
`);
  commitAll(repoPath, 'feature change');

  const fixturePath = path.join(repoPath, 'mock-runtime.json');
  writeJson(fixturePath, {
    runs: [
      {
        data: {
          intentSummary: 'The PR updates one TypeScript function and should be reviewed by the inline GitHub reviewer only.',
          selectedReviewers: [
            { reviewerId: 'github-inline-reviewer', reason: 'Changed TypeScript code should be reviewed.' , confidence: 0.9 },
          ],
        },
      },
      {
        data: {
          verifications: [
            {
              findingId: 'GITHUB_INLINE_REVIEWER_1',
              supported: true,
              classification: 'direct',
              reason: 'The finding is supported by the changed code and current file state.',
            },
          ],
        },
      },
    ],
    agenticRuns: [
      {
        data: {
          score: 88,
          summary: 'One actionable issue found.',
          findings: [
            {
              id: 'GITHUB_INLINE_REVIEWER_1',
              title: 'Trimmed input is returned directly',
              description: 'The changed code returns the normalized input directly.',
              priority: 'medium',
              confidence: 0.95,
              filePath: 'src/service.ts',
              startLine: 2,
              endLine: 2,
              codeQuote: '  const normalized = name.trim();',
              evidence: ['src/service.ts returns the normalized input directly.'],
              verificationTrail: ['file:src/service.ts', 'search:return normalized'],
              searchedFor: ['validation'],
              recommendation: 'Validate the normalized value before returning it.',
              tags: ['code-quality'],
            },
          ],
        },
      },
    ],
  });

  const octokitFixturePath = path.join(repoPath, 'octokit-state.json');
  writeJson(octokitFixturePath, {
    pullRequest: {
      baseRef: 'main',
      baseSha: 'base-sha',
      headRef: 'feature/github-inline-fallback',
      headSha: 'head-sha',
    },
    failCreateReviewComment: [{ path: 'src/service.ts', line: 2 }],
    issueComments: [],
    reviewComments: [],
    actions: [],
  });

  const hookPath = path.join(process.cwd(), 'test', 'integration', 'mock-octokit-hook.cjs');
  const result = spawnSync('node', ['--require', hookPath, 'dist/index.js', 'pr-review', '--cwd', repoPath, '--base', 'main', '--github', '--pr-number', '9'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BATEYE_LLM_MODEL_API_KEY: 'direct-test-key',
      BATEYE_RUNTIME: 'mock',
      BATEYE_MOCK_RUNTIME_FIXTURES: fixturePath,
      BATEYE_OCTOKIT_FIXTURES: octokitFixturePath,
      GITHUB_TOKEN: 'github-test-token',
      GITHUB_REPOSITORY: 'BatEyeOrg/BatEye',
      PR_NUMBER: '9',
    },
    encoding: 'utf-8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const report = JSON.parse(fs.readFileSync(path.join(repoPath, '.bateye', 'out', 'pr-review.json'), 'utf-8'));
  assert.equal(report.status, 'complete');
  assert.equal(report.findings.length, 1);
  assert.equal(report.issues.length, 0);

  const octokitState = JSON.parse(fs.readFileSync(octokitFixturePath, 'utf-8'));
  const actionTypes = octokitState.actions.map(action => action.type);
  assert.ok(actionTypes.includes('createComment'));
  const fallbackComment = octokitState.issueComments.find(comment => /BatEye follow-up/.test(comment.body));
  assert.ok(fallbackComment);
});

test('pr-review command bundles two same-category reviewers into a single agentic session and attributes findings per reviewer', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-pr-review-bundle-int-'));
  initGitRepo(repoPath);

  writeJson(path.join(repoPath, '.bateye', 'config.json'), {
    model: 'anthropic/mock-model',
    exclude: [],
  });

  // Two reviewers with categories that map into the same bundle ('security' bundle slot).
  writeText(path.join(repoPath, '.bateye', 'reviewers', 'secret-scan.md'), `---
id: secret-scan
name: Secret Scan Reviewer
mode: pr-review
category: security
---
Look for leaked secrets or credentials in the changed code.
`);

  writeText(path.join(repoPath, '.bateye', 'reviewers', 'dep-audit.md'), `---
id: dep-audit
name: Dependency Audit Reviewer
mode: pr-review
category: dependency
---
Look for risky dependency additions or version bumps in the changed code.
`);

  writeText(path.join(repoPath, 'src', 'service.ts'), `export function getToken() {
  return 'placeholder';
}
`);
  commitAll(repoPath, 'base');

  runOk('git', ['checkout', '-b', 'feature/pr-review-bundle'], { cwd: repoPath });

  writeText(path.join(repoPath, 'src', 'service.ts'), `export function getToken() {
  const key = 'sk-live-leaked-demo-placeholder';
  const tracker = require('telemetry-tracker-9000');
  tracker.init(key);
  return key;
}
`);
  commitAll(repoPath, 'feature change');

  const fixturePath = path.join(repoPath, 'mock-runtime.json');
  const logPath = path.join(repoPath, 'mock-runtime-log.json');
  writeJson(fixturePath, {
    runs: [
      {
        // Orchestrator picks both reviewers and explicitly bundles them together.
        data: {
          intentSummary: 'The PR introduces a token helper and should be checked by secret-scan and dep-audit together.',
          selectedReviewers: [
            { reviewerId: 'secret-scan', reason: 'Changed code introduces a token-shaped literal.', confidence: 0.9 },
            { reviewerId: 'dep-audit', reason: 'Token helper may signal a new dependency path.', confidence: 0.85 },
          ],
          executionPlan: [
            {
              groupId: 'security',
              mode: 'standard',
              reason: 'Both reviewers inspect the same sensitive code path.',
              reviewerIds: ['secret-scan', 'dep-audit'],
            },
          ],
        },
      },
      // Semantic verification response: both bundle findings supported.
      {
        data: {
          verifications: [
            {
              findingId: 'SECRET_SCAN_PR_1',
              supported: true,
              classification: 'direct',
              reason: 'The literal token is present on the changed line.',
            },
            {
              findingId: 'DEP_AUDIT_PR_1',
              supported: true,
              classification: 'direct',
              reason: 'The helper introduces a token handling path on the changed line.',
            },
          ],
        },
      },
    ],
    // Exactly ONE agentic run for the bundled group — this is the core assertion.
    agenticRuns: [
      {
        data: {
          perReviewer: [
            { reviewerId: 'secret-scan', score: 40, summary: 'Leaked secret literal in the new helper.' },
            { reviewerId: 'dep-audit', score: 70, summary: 'Token helper may indicate new dependency surface.' },
          ],
          findings: [
            {
              id: 'SECRET_SCAN_PR_1',
              reviewerId: 'secret-scan',
              title: 'Leaked secret literal in token helper',
              description: 'The changed line assigns a hard-coded token-shaped literal that should be removed.',
              priority: 'high',
              confidence: 0.95,
              filePath: 'src/service.ts',
              startLine: 2,
              endLine: 2,
              codeQuote: "  const key = 'sk-live-leaked-demo-placeholder';",
              evidence: ['src/service.ts line 2 introduces a literal credential on the changed line.'],
              verificationTrail: ['file:src/service.ts'],
              searchedFor: ['sk-live'],
              recommendation: 'Load the token from an environment variable or secret manager.',
              tags: ['security'],
            },
            {
              id: 'DEP_AUDIT_PR_1',
              reviewerId: 'dep-audit',
              title: 'Unvetted telemetry tracker dependency introduced',
              description: 'The changed block pulls in an unvetted external tracker package at runtime.',
              priority: 'medium',
              confidence: 0.85,
              filePath: 'src/service.ts',
              startLine: 3,
              endLine: 3,
              codeQuote: "  const tracker = require('telemetry-tracker-9000');",
              evidence: ['src/service.ts line 3 introduces a new telemetry-tracker-9000 dependency.'],
              verificationTrail: ['file:src/service.ts'],
              recommendation: 'Add telemetry-tracker-9000 to the dependency audit allowlist or remove it.',
              tags: ['dependency'],
            },
          ],
        },
      },
    ],
  });

  const result = runPRReview(['--cwd', repoPath, '--base', 'main', '--dry-run'], {
    BATEYE_LLM_MODEL_API_KEY: 'direct-test-key',
    BATEYE_RUNTIME: 'mock',
    BATEYE_MOCK_RUNTIME_FIXTURES: fixturePath,
    BATEYE_MOCK_RUNTIME_LOG: logPath,
  });
  const combinedOutput = result.stdout + result.stderr;

  assert.equal(result.status, 0, result.stderr || result.stdout);

  // Exactly ONE agentic run — both reviewers shared one session.
  const runtimeLog = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
  const agenticEntries = runtimeLog.filter(entry => entry.type === 'runAgenticReview');
  assert.equal(agenticEntries.length, 1, 'expected one bundled agentic run for two same-category reviewers');

  // The bundle call uses the bateye-review agent and is labelled as a bundle.
  assert.equal(agenticEntries[0].agent, 'bateye-review');
  assert.equal(agenticEntries[0].callLabel, 'bundle:security');

  // Pipeline log should mention the execution plan with both reviewers.
  assert.match(combinedOutput, /Execution plan/);
  assert.match(combinedOutput, /security\[standard\]/);
  assert.match(combinedOutput, /Secret Scan Reviewer\+Dependency Audit Reviewer|Dependency Audit Reviewer\+Secret Scan Reviewer/);

  // Both findings land in the final report, each attributed to its originating reviewer.
  const report = JSON.parse(fs.readFileSync(path.join(repoPath, '.bateye', 'out', 'pr-review.json'), 'utf-8'));
  assert.equal(report.findings.length, 2, 'both bundle findings should survive verification');

  const byReviewer = new Map(report.findings.map(f => [f.reviewerId, f]));
  const secretFinding = byReviewer.get('secret-scan');
  const depFinding = byReviewer.get('dep-audit');
  assert.ok(secretFinding, 'secret-scan finding should be present');
  assert.ok(depFinding, 'dep-audit finding should be present');
  assert.equal(secretFinding.reviewerName, 'Secret Scan Reviewer');
  assert.equal(depFinding.reviewerName, 'Dependency Audit Reviewer');
});

test('pr-review command drops bundle findings whose reviewerId is not in the group', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-pr-review-bundle-stray-'));
  initGitRepo(repoPath);

  writeJson(path.join(repoPath, '.bateye', 'config.json'), {
    model: 'anthropic/mock-model',
    exclude: [],
  });

  writeText(path.join(repoPath, '.bateye', 'reviewers', 'secret-scan.md'), `---
id: secret-scan
name: Secret Scan Reviewer
mode: pr-review
category: security
---
Look for leaked secrets in the changed code.
`);

  writeText(path.join(repoPath, '.bateye', 'reviewers', 'dep-audit.md'), `---
id: dep-audit
name: Dependency Audit Reviewer
mode: pr-review
category: dependency
---
Look for risky dependency additions.
`);

  writeText(path.join(repoPath, 'src', 'service.ts'), `export const value = 0;\n`);
  commitAll(repoPath, 'base');

  runOk('git', ['checkout', '-b', 'feature/pr-review-bundle-stray'], { cwd: repoPath });
  writeText(path.join(repoPath, 'src', 'service.ts'), `export const value = 1;\n`);
  commitAll(repoPath, 'feature change');

  const fixturePath = path.join(repoPath, 'mock-runtime.json');
  const logPath = path.join(repoPath, 'mock-runtime-log.json');
  writeJson(fixturePath, {
    runs: [
      {
        data: {
          intentSummary: 'The PR bumps a constant.',
          selectedReviewers: [
            { reviewerId: 'secret-scan', reason: 'placeholder', confidence: 0.85 },
            { reviewerId: 'dep-audit', reason: 'placeholder', confidence: 0.85 },
          ],
          executionPlan: [
            {
              groupId: 'security',
              mode: 'standard',
              reason: 'Share sensitive paths.',
              reviewerIds: ['secret-scan', 'dep-audit'],
            },
          ],
        },
      },
      {
        data: {
          verifications: [
            {
              findingId: 'SECRET_SCAN_PR_1',
              supported: true,
              classification: 'direct',
              reason: 'Anchored to the changed line.',
            },
          ],
        },
      },
    ],
    agenticRuns: [
      {
        data: {
          perReviewer: [
            { reviewerId: 'secret-scan', score: 80, summary: 'one finding' },
            { reviewerId: 'dep-audit', score: 100, summary: '' },
          ],
          findings: [
            {
              id: 'SECRET_SCAN_PR_1',
              reviewerId: 'secret-scan',
              title: 'Changed constant exposed',
              description: 'The constant is changed on the diff line.',
              priority: 'low',
              confidence: 0.85,
              filePath: 'src/service.ts',
              startLine: 1,
              endLine: 1,
              codeQuote: 'export const value = 1;',
              evidence: ['src/service.ts line 1 changes the exported value.'],
              verificationTrail: ['file:src/service.ts'],
              recommendation: 'Verify the intended change.',
              tags: [],
            },
            {
              // Stray finding: reviewerId not in the bundled group.
              id: 'STRAY_PR_1',
              reviewerId: 'ghost-reviewer',
              title: 'Attributed to unknown reviewer',
              description: 'This finding should be dropped as a schema violation.',
              priority: 'low',
              confidence: 0.85,
              filePath: 'src/service.ts',
              startLine: 1,
              endLine: 1,
              codeQuote: 'export const value = 1;',
              evidence: ['src/service.ts line 1.'],
              verificationTrail: ['file:src/service.ts'],
              recommendation: 'Drop this finding.',
              tags: [],
            },
          ],
        },
      },
    ],
  });

  const result = runPRReview(['--cwd', repoPath, '--base', 'main', '--dry-run'], {
    BATEYE_LLM_MODEL_API_KEY: 'direct-test-key',
    BATEYE_RUNTIME: 'mock',
    BATEYE_MOCK_RUNTIME_FIXTURES: fixturePath,
    BATEYE_MOCK_RUNTIME_LOG: logPath,
  });
  const combinedOutput = result.stdout + result.stderr;

  assert.equal(result.status, 0, result.stderr || result.stdout);

  // The stray finding must be reported as dropped.
  assert.match(combinedOutput, /dropped 1 finding\(s\) with unknown reviewerId/);

  // Only the valid finding survives.
  const report = JSON.parse(fs.readFileSync(path.join(repoPath, '.bateye', 'out', 'pr-review.json'), 'utf-8'));
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0].reviewerId, 'secret-scan');
});

test('pr-review command fails clearly when non-agentic direct runtime is requested', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-pr-review-direct-runtime-'));
  initGitRepo(repoPath);

  writeJson(path.join(repoPath, '.bateye', 'config.json'), {
    model: 'anthropic/mock-model',
    exclude: [],
  });

  writeText(path.join(repoPath, 'src', 'service.ts'), `export const changed = true;\n`);
  commitAll(repoPath, 'base');

  runOk('git', ['checkout', '-b', 'feature/direct-runtime'], { cwd: repoPath });
  writeText(path.join(repoPath, 'src', 'service.ts'), `export const changed = false;\n`);
  commitAll(repoPath, 'feature change');

  const result = runPRReview(['--cwd', repoPath, '--base', 'main', '--dry-run'], {
    BATEYE_LLM_MODEL_API_KEY: 'direct-test-key',
    BATEYE_RUNTIME: 'direct',
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /Agentic PR review cannot use BATEYE_RUNTIME=direct/);
});
