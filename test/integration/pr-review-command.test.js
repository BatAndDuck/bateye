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
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'codeowl-pr-review-int-'));
  initGitRepo(repoPath);

  writeJson(path.join(repoPath, '.codeowl', 'config.json'), {
    model: 'anthropic/mock-model',
    exclude: [],
  });

  writeText(path.join(repoPath, '.codeowl', 'reviewers', 'pr-tool.md'), `---
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

  writeText(path.join(repoPath, '.codeowl', 'reviewers', 'pr-follow-up.md'), `---
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
          selectedReviewers: [
            { reviewerId: 'pr-tool', reason: 'Changed TypeScript logic needs a security scan.' },
            { reviewerId: 'pr-follow-up', reason: 'The updated function should get a code quality pass.' },
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
    CODE_OWL_LLM_MODEL_API_KEY: 'direct-test-key',
    CODEOWL_RUNTIME: 'mock',
    CODEOWL_MOCK_RUNTIME_FIXTURES: fixturePath,
    CODEOWL_MOCK_RUNTIME_LOG: logPath,
  });
  const combinedOutput = result.stdout + result.stderr;

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const reportPath = path.join(repoPath, '.codeowl', 'out', 'pr-review.json');
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
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'codeowl-pr-review-empty-int-'));
  initGitRepo(repoPath);

  writeJson(path.join(repoPath, '.codeowl', 'config.json'), {
    model: 'anthropic/mock-model',
    exclude: [],
  });

  writeText(path.join(repoPath, 'src', 'service.ts'), 'export const stable = true;\n');
  commitAll(repoPath, 'base');

  const fixturePath = path.join(repoPath, 'mock-runtime.json');
  writeJson(fixturePath, { runs: [], agenticRuns: [] });

  const result = runPRReview(['--cwd', repoPath, '--base', 'HEAD', '--head', 'HEAD', '--dry-run'], {
    CODE_OWL_LLM_MODEL_API_KEY: 'direct-test-key',
    CODEOWL_RUNTIME: 'mock',
    CODEOWL_MOCK_RUNTIME_FIXTURES: fixturePath,
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /No changed files found between the specified refs/);
  assert.equal(fs.existsSync(path.join(repoPath, '.codeowl', 'out', 'pr-review.json')), false);
});

test('pr-review command broadens built-in reviewer coverage when the orchestrator shortlist is too narrow', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'codeowl-pr-review-broad-coverage-'));
  initGitRepo(repoPath);

  writeJson(path.join(repoPath, '.codeowl', 'config.json'), {
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
          selectedReviewers: [
            { reviewerId: 'bug-hunter', reason: 'Changed TypeScript logic should get a bug pass.' },
          ],
        },
      },
    ],
    agenticRuns: [
      { data: { score: 92, summary: 'No bug issues found.', findings: [] } },
      { data: { score: 90, summary: 'No code quality issues found.', findings: [] } },
      { data: { score: 88, summary: 'No complexity issues found.', findings: [] } },
      { data: { score: 89, summary: 'No test-quality issues found.', findings: [] } },
    ],
  });

  const result = runPRReview(['--cwd', repoPath, '--base', 'main', '--dry-run'], {
    CODE_OWL_LLM_MODEL_API_KEY: 'direct-test-key',
    CODEOWL_RUNTIME: 'mock',
    CODEOWL_MOCK_RUNTIME_FIXTURES: fixturePath,
    CODEOWL_MOCK_RUNTIME_LOG: logPath,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const report = JSON.parse(fs.readFileSync(path.join(repoPath, '.codeowl', 'out', 'pr-review.json'), 'utf-8'));
  const selectedIds = report.selectedReviewers.map(reviewer => reviewer.reviewerId);
  assert.deepEqual(selectedIds, ['bug-hunter', 'code-quality', 'complexity']);

  const runtimeLog = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
  assert.equal(runtimeLog.filter(entry => entry.type === 'runAgenticReview').length, 3);
});

test('pr-review command trims overlapping broad reviewers while keeping domain-specific ones', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'codeowl-pr-review-stable-selection-'));
  initGitRepo(repoPath);

  writeJson(path.join(repoPath, '.codeowl', 'config.json'), {
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
          selectedReviewers: [
            { reviewerId: 'error-handling', reason: 'Error path changed.' },
            { reviewerId: 'log-reviewer', reason: 'Logging changed.' },
            { reviewerId: 'complexity', reason: 'Complexity changed.' },
            { reviewerId: 'code-quality', reason: 'General code quality.' },
            { reviewerId: 'clean-code', reason: 'Readability changed.' },
            { reviewerId: 'test-quality', reason: 'Tests may need review.' },
            { reviewerId: 'resiliency', reason: 'Network call changed.' },
            { reviewerId: 'bug-hunter', reason: 'Logic changed.' },
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
    ],
  });

  const result = runPRReview(['--cwd', repoPath, '--base', 'main', '--dry-run'], {
    CODE_OWL_LLM_MODEL_API_KEY: 'direct-test-key',
    CODEOWL_RUNTIME: 'mock',
    CODEOWL_MOCK_RUNTIME_FIXTURES: fixturePath,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const report = JSON.parse(fs.readFileSync(path.join(repoPath, '.codeowl', 'out', 'pr-review.json'), 'utf-8'));
  const selectedIds = report.selectedReviewers.map(reviewer => reviewer.reviewerId);
  assert.deepEqual(selectedIds, ['error-handling', 'log-reviewer', 'complexity', 'code-quality', 'test-quality', 'resiliency']);
});

test('pr-review command reports degraded status when review coverage is reduced by tool failures', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'codeowl-pr-review-degraded-'));
  initGitRepo(repoPath);

  writeJson(path.join(repoPath, '.codeowl', 'config.json'), {
    model: 'anthropic/mock-model',
    exclude: [],
  });

  writeText(path.join(repoPath, '.codeowl', 'reviewers', 'failing-tool-reviewer.md'), `---
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

  writeText(path.join(repoPath, '.codeowl', 'reviewers', 'plain-reviewer.md'), `---
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
          selectedReviewers: [
            { reviewerId: 'failing-tool-reviewer', reason: 'Security pass.' },
            { reviewerId: 'plain-reviewer', reason: 'Code quality pass.' },
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
    CODE_OWL_LLM_MODEL_API_KEY: 'direct-test-key',
    CODEOWL_RUNTIME: 'mock',
    CODEOWL_MOCK_RUNTIME_FIXTURES: fixturePath,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Status:\s+DEGRADED/);
  assert.match(result.stdout, /Review issues/);

  const report = JSON.parse(fs.readFileSync(path.join(repoPath, '.codeowl', 'out', 'pr-review.json'), 'utf-8'));
  assert.equal(report.status, 'degraded');
  assert.equal(report.findings.length, 0);
  assert.ok(report.issues.some(issue => issue.code === 'pr-reviewer-optional-tool-failed'));
  assert.match(report.summary, /Review completed with warnings/);
});

test('pr-review command rejects false positives when current code preserves the behavior elsewhere in the file', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'codeowl-pr-review-inline-fp-'));
  initGitRepo(repoPath);

  writeJson(path.join(repoPath, '.codeowl', 'config.json'), {
    model: 'anthropic/mock-model',
    exclude: [],
  });

  writeText(path.join(repoPath, '.codeowl', 'reviewers', 'bug-hunter-local.md'), `---
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
          selectedReviewers: [
            { reviewerId: 'bug-hunter-local', reason: 'Potential logic regression in config handling.' },
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
    CODE_OWL_LLM_MODEL_API_KEY: 'direct-test-key',
    CODEOWL_RUNTIME: 'mock',
    CODEOWL_MOCK_RUNTIME_FIXTURES: fixturePath,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const report = JSON.parse(fs.readFileSync(path.join(repoPath, '.codeowl', 'out', 'pr-review.json'), 'utf-8'));
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
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'codeowl-pr-review-workflow-fp-'));
  initGitRepo(repoPath);

  writeJson(path.join(repoPath, '.codeowl', 'config.json'), {
    model: 'anthropic/mock-model',
    exclude: [],
  });

  writeText(path.join(repoPath, '.codeowl', 'reviewers', 'ci-cd-local.md'), `---
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
          selectedReviewers: [
            { reviewerId: 'ci-cd-local', reason: 'Workflow file changed.' },
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
    CODE_OWL_LLM_MODEL_API_KEY: 'direct-test-key',
    CODEOWL_RUNTIME: 'mock',
    CODEOWL_MOCK_RUNTIME_FIXTURES: fixturePath,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const report = JSON.parse(fs.readFileSync(path.join(repoPath, '.codeowl', 'out', 'pr-review.json'), 'utf-8'));
  assert.equal(report.findings.length, 0);
  assert.equal(report.verificationStats.semanticRejected, 1);
});

test('pr-review command rejects findings anchored only to removed code', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'codeowl-pr-review-removed-code-'));
  initGitRepo(repoPath);

  writeJson(path.join(repoPath, '.codeowl', 'config.json'), {
    model: 'anthropic/mock-model',
    exclude: [],
  });

  writeText(path.join(repoPath, '.codeowl', 'reviewers', 'removed-code-reviewer.md'), `---
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
          selectedReviewers: [
            { reviewerId: 'removed-code-reviewer', reason: 'Changed function body.' },
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
    CODE_OWL_LLM_MODEL_API_KEY: 'direct-test-key',
    CODEOWL_RUNTIME: 'mock',
    CODEOWL_MOCK_RUNTIME_FIXTURES: fixturePath,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const report = JSON.parse(fs.readFileSync(path.join(repoPath, '.codeowl', 'out', 'pr-review.json'), 'utf-8'));
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
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'codeowl-pr-review-github-int-'));
  initGitRepo(repoPath);

  writeJson(path.join(repoPath, '.codeowl', 'config.json'), {
    model: 'anthropic/mock-model',
    exclude: [],
    prReview: {
      autoApprove: {
        enabled: true,
        maxSeverity: 'low',
      },
    },
  });

  writeText(path.join(repoPath, '.codeowl', 'reviewers', 'github-reviewer.md'), `---
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
          selectedReviewers: [
            { reviewerId: 'github-reviewer', reason: 'Updated TypeScript code should be reviewed.' },
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
        body: '<!-- codeowl-status -->\nOld status body',
        user: { login: 'codeowl-bot' },
        created_at: '2026-03-15T00:00:00Z',
      },
      {
        id: 11,
        body: '<!-- codeowl-summary -->\nOld summary body',
        user: { login: 'codeowl-bot' },
        created_at: '2026-03-15T00:00:00Z',
      },
    ],
    reviewComments: [
      {
        id: 21,
        body: '🟢 **[CodeOwl LOW] Trimmed input is returned directly**\n\nAlready posted.',
        path: 'src/service.ts',
        line: 2,
        user: { login: 'codeowl-bot' },
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
      CODE_OWL_LLM_MODEL_API_KEY: 'direct-test-key',
      CODEOWL_RUNTIME: 'mock',
      CODEOWL_MOCK_RUNTIME_FIXTURES: fixturePath,
      CODEOWL_OCTOKIT_FIXTURES: octokitFixturePath,
      GITHUB_TOKEN: 'github-test-token',
      GITHUB_REPOSITORY: 'CodeOwlOrg/CodeOwl',
      PR_NUMBER: '7',
      COMMENT_ID: '99',
    },
    encoding: 'utf-8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const report = JSON.parse(fs.readFileSync(path.join(repoPath, '.codeowl', 'out', 'pr-review.json'), 'utf-8'));
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
  assert.deepEqual(actionTypes, ['updateComment', 'createReaction', 'updateComment', 'updateComment', 'createReview']);
  assert.equal(actionTypes.includes('createReviewComment'), false);

  const updatedStatus = octokitState.issueComments.find(comment => comment.id === 10);
  const updatedSummary = octokitState.issueComments.find(comment => comment.id === 11);
  assert.match(updatedStatus.body, /0 findings posted/);
  assert.match(updatedSummary.body, /No issues found/);
});

test('pr-review command falls back to a general PR comment when an inline line cannot be resolved', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'codeowl-pr-review-inline-fallback-'));
  initGitRepo(repoPath);

  writeJson(path.join(repoPath, '.codeowl', 'config.json'), {
    model: 'anthropic/mock-model',
    exclude: [],
  });

  writeText(path.join(repoPath, '.codeowl', 'reviewers', 'github-inline-reviewer.md'), `---
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
          selectedReviewers: [
            { reviewerId: 'github-inline-reviewer', reason: 'Changed TypeScript code should be reviewed.' },
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
      CODE_OWL_LLM_MODEL_API_KEY: 'direct-test-key',
      CODEOWL_RUNTIME: 'mock',
      CODEOWL_MOCK_RUNTIME_FIXTURES: fixturePath,
      CODEOWL_OCTOKIT_FIXTURES: octokitFixturePath,
      GITHUB_TOKEN: 'github-test-token',
      GITHUB_REPOSITORY: 'CodeOwlOrg/CodeOwl',
      PR_NUMBER: '9',
    },
    encoding: 'utf-8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const report = JSON.parse(fs.readFileSync(path.join(repoPath, '.codeowl', 'out', 'pr-review.json'), 'utf-8'));
  assert.equal(report.status, 'complete');
  assert.equal(report.findings.length, 1);
  assert.equal(report.issues.length, 0);

  const octokitState = JSON.parse(fs.readFileSync(octokitFixturePath, 'utf-8'));
  const actionTypes = octokitState.actions.map(action => action.type);
  assert.ok(actionTypes.includes('createComment'));
  const fallbackComment = octokitState.issueComments.find(comment => /CodeOwl follow-up/.test(comment.body));
  assert.ok(fallbackComment);
});

test('pr-review command fails clearly when non-agentic direct runtime is requested', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'codeowl-pr-review-direct-runtime-'));
  initGitRepo(repoPath);

  writeJson(path.join(repoPath, '.codeowl', 'config.json'), {
    model: 'anthropic/mock-model',
    exclude: [],
  });

  writeText(path.join(repoPath, 'src', 'service.ts'), `export const changed = true;\n`);
  commitAll(repoPath, 'base');

  runOk('git', ['checkout', '-b', 'feature/direct-runtime'], { cwd: repoPath });
  writeText(path.join(repoPath, 'src', 'service.ts'), `export const changed = false;\n`);
  commitAll(repoPath, 'feature change');

  const result = runPRReview(['--cwd', repoPath, '--base', 'main', '--dry-run'], {
    CODE_OWL_LLM_MODEL_API_KEY: 'direct-test-key',
    CODEOWL_RUNTIME: 'direct',
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /Agentic PR review cannot use CODEOWL_RUNTIME=direct/);
});
