const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { commitAll, initGitRepo, runOk, writeJson, writeText } = require('./helpers');

test('pr-review command analyzes a real git diff, runs file tools, and writes the final report', () => {
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
Report only concrete security problems visible in the diff.
`);

  writeText(path.join(repoPath, '.codeowl', 'reviewers', 'pr-follow-up.md'), `---
id: pr-follow-up
name: PR Follow-up Reviewer
mode: pr-review
category: code-quality
---
Report only concrete code quality problems visible in the diff.
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
          score: 70,
          summary: 'One concrete issue found in the new normalization flow.',
          findings: [
            {
              id: 'PR_TOOL_PR_1',
              title: 'Normalized input is returned without escaping',
              description: 'The new code returns the trimmed user input directly from the diffed line.',
              priority: 'high',
              confidence: 0.94,
              filePath: 'src/service.ts',
              startLine: 2,
              endLine: 2,
              codeQuote: '  const normalized = name.trim();',
              evidence: ['const normalized = name.trim();'],
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
              description: 'The diff shows the normalized input being returned without any additional validation.',
              priority: 'high',
              confidence: 0.9,
              filePath: 'src/service.ts',
              startLine: 2,
              endLine: 2,
              codeQuote: '  const normalized = name.trim();',
              evidence: ['const normalized = name.trim();'],
              recommendation: 'Introduce validation before the value reaches the return statement.',
              tags: ['code-quality'],
            },
            {
              id: 'PR_FOLLOW_UP_PR_2',
              title: 'Reviewer referenced a file outside the diff',
              description: 'This intentionally invalid finding should be rejected by verification.',
              priority: 'medium',
              confidence: 0.88,
              filePath: 'src/other.ts',
              startLine: 1,
              endLine: 1,
              codeQuote: 'export const missing = true;',
              evidence: ['export const missing = true;'],
              recommendation: 'Ignore this finding because it is outside the diff.',
              tags: ['test'],
            },
          ],
        },
      },
    ],
  });

  const result = spawnSync('node', ['dist/index.js', 'pr-review', '--cwd', repoPath, '--base', 'main', '--dry-run'], {
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

  const reportPath = path.join(repoPath, '.codeowl', 'out', 'pr-review.json');
  assert.ok(fs.existsSync(reportPath));

  const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
  assert.equal(report.command, 'pr-review');
  assert.equal(report.baseRef, 'main');
  assert.equal(report.headRef, 'HEAD');
  assert.equal(report.selectedReviewers.length, 2);
  assert.equal(report.findings.length, 1);
  assert.equal(report.rejectedFindings, 1);
  assert.match(report.summary, /Static Analysis Scanners/);
  assert.match(report.summary, /PR Tool Reviewer/);
  assert.match(report.summary, /1 findings were filtered out during evidence verification/);

  const finding = report.findings[0];
  assert.equal(finding.filePath, 'src/service.ts');
  assert.equal(finding.startLine, 2);
  assert.match(finding.reviewerId, /pr-tool/);
  assert.match(finding.reviewerId, /pr-follow-up/);
  assert.match(finding.reviewerName, /PR Tool Reviewer/);
  assert.match(finding.reviewerName, /PR Follow-up Reviewer/);

  const toolLog = JSON.parse(fs.readFileSync(path.join(repoPath, 'pr-tool-log.json'), 'utf-8'));
  assert.deepEqual(toolLog.files, ['src/service.ts']);

  const runtimeLog = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
  assert.equal(runtimeLog.filter(entry => entry.type === 'run').length, 3);
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
  writeJson(fixturePath, { runs: [] });

  const result = spawnSync('node', ['dist/index.js', 'pr-review', '--cwd', repoPath, '--base', 'HEAD', '--head', 'HEAD', '--dry-run'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CODE_OWL_LLM_MODEL_API_KEY: 'direct-test-key',
      CODEOWL_RUNTIME: 'mock',
      CODEOWL_MOCK_RUNTIME_FIXTURES: fixturePath,
    },
    encoding: 'utf-8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /No changed files found between the specified refs/);
  assert.equal(fs.existsSync(path.join(repoPath, '.codeowl', 'out', 'pr-review.json')), false);
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
Report only concrete code quality findings visible in the diff.
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
          score: 92,
          summary: 'Only one low-severity issue found, but it matches an existing comment.',
          findings: [
            {
              id: 'GITHUB_REVIEWER_1',
              title: 'Trimmed input is returned directly',
              description: 'The diff shows the normalized user input flowing straight to the return statement.',
              priority: 'low',
              confidence: 0.95,
              filePath: 'src/service.ts',
              startLine: 2,
              endLine: 2,
              codeQuote: '  const normalized = name.trim();',
              evidence: ['const normalized = name.trim();'],
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

  const octokitState = JSON.parse(fs.readFileSync(octokitFixturePath, 'utf-8'));
  const actionTypes = octokitState.actions.map(action => action.type);
  assert.deepEqual(actionTypes, ['updateComment', 'createReaction', 'updateComment', 'updateComment', 'createReview']);
  assert.equal(actionTypes.includes('createReviewComment'), false);

  const updatedStatus = octokitState.issueComments.find(comment => comment.id === 10);
  const updatedSummary = octokitState.issueComments.find(comment => comment.id === 11);
  assert.match(updatedStatus.body, /0 findings posted/);
  assert.match(updatedSummary.body, /No issues found/);
});
