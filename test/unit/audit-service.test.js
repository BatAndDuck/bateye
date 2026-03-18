const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { runAudit } = require('../../dist/features/audit/application/audit-service');
const { MAX_CONCURRENT_AUDIT_REVIEWERS } = require('../../dist/core/config/defaults');

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

function setApiKey(value) {
  const original = process.env.CODE_OWL_LLM_MODEL_API_KEY;
  process.env.CODE_OWL_LLM_MODEL_API_KEY = value;
  return () => {
    if (original === undefined) delete process.env.CODE_OWL_LLM_MODEL_API_KEY;
    else process.env.CODE_OWL_LLM_MODEL_API_KEY = original;
  };
}

test('runAudit throws when a reviewer runtime call fails', async () => {
  const repoPath = makeRepo();
  const restoreApiKey = setApiKey('test-api-key');
  fs.mkdirSync(path.join(repoPath, '.codeowl', 'reviewers'), { recursive: true });
  fs.writeFileSync(
    path.join(repoPath, '.codeowl', 'reviewers', 'failing-reviewer.md'),
    `---
id: failing-reviewer
name: Failing Reviewer
mode: audit
---
Fail on purpose.
`,
  );

  try {
    await assert.rejects(
      () => runAudit(
        { repoPath, reviewerIds: ['failing-reviewer'] },
        {
          getRuntime: async () => ({
            async runAgenticReview() {
              throw new Error('401 Error verifying OIDC token');
            },
            async run() {
              throw new Error('orchestrator runtime should not be used in this test');
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
      /All reviewers failed/,
    );
  } finally {
    restoreApiKey();
  }
});

test('runAudit runs reviewers concurrently with a cap of 10', async () => {
  const repoPath = makeRepo();
  const restoreApiKey = setApiKey('test-api-key');
  fs.mkdirSync(path.join(repoPath, '.codeowl', 'reviewers'), { recursive: true });

  for (let i = 0; i < 12; i++) {
    fs.writeFileSync(
      path.join(repoPath, '.codeowl', 'reviewers', `reviewer-${i}.md`),
      `---
id: reviewer-${i}
name: Reviewer ${i}
mode: audit
---
Check reviewer ${i}.
`,
    );
  }

  let activeRuns = 0;
  let maxActiveRuns = 0;

  try {
    const result = await runAudit(
      { repoPath, reviewerIds: Array.from({ length: 12 }, (_, index) => `reviewer-${index}`) },
      {
        getRuntime: async () => ({
          async runAgenticReview(_options, schema) {
            activeRuns += 1;
            maxActiveRuns = Math.max(maxActiveRuns, activeRuns);
            const CONCURRENCY_TEST_DELAY_MS = 25; // small delay to allow concurrent reviewers to interleave
            await new Promise(resolve => setTimeout(resolve, CONCURRENCY_TEST_DELAY_MS));
            activeRuns -= 1;
            return {
              data: schema.parse({ score: 85, summary: 'ok', findings: [] }),
              model: 'anthropic/mock-model',
              runtime: 'sdk',
              durationMs: 0,
              rawResponse: '',
            };
          },
          async run() {
            throw new Error('orchestrator runtime should not be used in this test');
          },
          async listModels() {
            return [];
          },
          async isAvailable() {
            return true;
          },
        }),
      },
    );

    assert.equal(result.reviewerResults.length, 12);
    assert.equal(maxActiveRuns, MAX_CONCURRENT_AUDIT_REVIEWERS);
  } finally {
    restoreApiKey();
  }
});

test('runAudit drops findings that point at generated artifacts', async () => {
  const repoPath = makeRepo();
  const restoreApiKey = setApiKey('test-api-key');
  fs.mkdirSync(path.join(repoPath, '.codeowl', 'reviewers'), { recursive: true });
  fs.writeFileSync(
    path.join(repoPath, '.codeowl', 'reviewers', 'generated-artifact.md'),
    `---
id: generated-artifact
name: Generated Artifact Reviewer
mode: audit
---
Check generated files.
`,
  );

  try {
    const result = await runAudit(
      { repoPath, reviewerIds: ['generated-artifact'] },
      {
        getRuntime: async () => ({
          async runAgenticReview(_options, schema) {
            return {
              data: schema.parse({
                score: 80,
                summary: 'Generated artifact issue found.',
                findings: [
                  {
                    id: 'GENERATED-001',
                    title: 'Generated file issue',
                    description: 'dist output should not be targeted.',
                    priority: 'high',
                    confidence: 0.9,
                    filePath: 'dist/index.js',
                    startLine: 1,
                    endLine: 1,
                    evidence: ['dist/index.js'],
                    recommendation: 'Fix dist/index.js',
                  },
                ],
              }),
              model: 'anthropic/mock-model',
              runtime: 'sdk',
              durationMs: 0,
              rawResponse: '',
            };
          },
          async run() {
            throw new Error('orchestrator runtime should not be used in this test');
          },
          async listModels() {
            return [];
          },
          async isAvailable() {
            return true;
          },
        }),
      },
    );

    assert.equal(result.reviewerResults[0].findings.length, 0);
  } finally {
    restoreApiKey();
  }
});

test('runAudit drops dependency-placement findings when the package is referenced by source code', async () => {
  const repoPath = makeRepo();
  const restoreApiKey = setApiKey('test-api-key');
  fs.writeFileSync(path.join(repoPath, 'src', 'index.ts'), 'export const tool = "dependency-cruiser";\n');
  fs.mkdirSync(path.join(repoPath, '.codeowl', 'reviewers'), { recursive: true });
  fs.writeFileSync(
    path.join(repoPath, '.codeowl', 'reviewers', 'dependency-noise.md'),
    `---
id: dependency-noise
name: Dependency Noise Reviewer
mode: audit
category: dependency
---
Check dependency placement.
`,
  );

  try {
    const result = await runAudit(
      { repoPath, reviewerIds: ['dependency-noise'] },
      {
        getRuntime: async () => ({
          async runAgenticReview(_options, schema) {
            return {
              data: schema.parse({
                score: 70,
                summary: 'Dependency placement issue found.',
                findings: [
                  {
                    id: 'DEPENDENCY_NOISE-001',
                    title: 'dependency-cruiser in production dependencies',
                    description: 'dependency-cruiser should be in devDependencies instead of production dependencies.',
                    priority: 'high',
                    confidence: 0.9,
                    filePath: 'package.json',
                    startLine: 1,
                    endLine: 1,
                    evidence: ['"dependency-cruiser": "^1.0.0"'],
                    recommendation: 'Move dependency-cruiser to devDependencies.',
                  },
                ],
              }),
              model: 'anthropic/mock-model',
              runtime: 'sdk',
              durationMs: 0,
              rawResponse: '',
            };
          },
          async run() {
            throw new Error('orchestrator runtime should not be used in this test');
          },
          async listModels() {
            return [];
          },
          async isAvailable() {
            return true;
          },
        }),
      },
    );

    assert.equal(result.reviewerResults[0].findings.length, 0);
  } finally {
    restoreApiKey();
  }
});

test('runAudit skips failed reviewers when at least one reviewer succeeds', async () => {
  const repoPath = makeRepo();
  const restoreApiKey = setApiKey('test-api-key');
  fs.mkdirSync(path.join(repoPath, '.codeowl', 'reviewers'), { recursive: true });

  for (const id of ['ok-reviewer', 'broken-reviewer']) {
    fs.writeFileSync(
      path.join(repoPath, '.codeowl', 'reviewers', `${id}.md`),
      `---
id: ${id}
name: ${id}
mode: audit
---
Check reviewer ${id}.
`,
    );
  }

  try {
    const result = await runAudit(
      { repoPath, reviewerIds: ['ok-reviewer', 'broken-reviewer'] },
      {
        getRuntime: async () => ({
          async runAgenticReview(options, schema) {
            if (options.systemPrompt.includes('broken-reviewer')) {
              throw new Error('schema mismatch');
            }
            return {
              data: schema.parse({ score: 85, summary: 'ok', findings: [] }),
              model: 'anthropic/mock-model',
              runtime: 'sdk',
              durationMs: 0,
              rawResponse: '',
            };
          },
          async run() {
            throw new Error('orchestrator runtime should not be used in this test');
          },
          async listModels() {
            return [];
          },
          async isAvailable() {
            return true;
          },
        }),
      },
    );

    assert.equal(result.reviewerResults.length, 1);
    assert.equal(result.reviewerResults[0].reviewerId, 'ok-reviewer');
  } finally {
    restoreApiKey();
  }
});

test('runAudit seeds audit reviewers with an adaptive file budget and accurate prompt counts', async () => {
  const repoPath = makeRepo();
  const restoreApiKey = setApiKey('test-api-key');
  fs.mkdirSync(path.join(repoPath, '.codeowl', 'reviewers'), { recursive: true });
  fs.mkdirSync(path.join(repoPath, 'src', 'components'), { recursive: true });

  for (let i = 0; i < 20; i++) {
    fs.writeFileSync(path.join(repoPath, 'src', 'components', `component-${i}.tsx`), `export const C${i} = () => null;\n`);
  }
  fs.writeFileSync(path.join(repoPath, 'vite.config.ts'), 'export default {};\n');
  fs.writeFileSync(path.join(repoPath, 'package.json'), '{"name":"seed-budget-test"}\n');

  fs.writeFileSync(
    path.join(repoPath, '.codeowl', 'reviewers', 'frontend-seeding.md'),
    `---
id: frontend-seeding
name: Frontend Seeding
mode: audit
category: performance
selectWhen: "select when the PR touches frontend build config or UI components"
---
Review frontend bundle signals.
`,
  );

  let capturedOptions;

  try {
    await runAudit(
      { repoPath, reviewerIds: ['frontend-seeding'] },
      {
        getRuntime: async () => ({
          async runAgenticReview(options, schema) {
            capturedOptions = options;
            return {
              data: schema.parse({ score: 85, summary: 'ok', findings: [] }),
              model: 'anthropic/mock-model',
              runtime: 'sdk',
              durationMs: 0,
              rawResponse: '',
            };
          },
          async run() {
            throw new Error('orchestrator runtime should not be used in this test');
          },
          async listModels() {
            return [];
          },
          async isAvailable() {
            return true;
          },
        }),
      },
    );

    assert.ok(capturedOptions);
    assert.equal(capturedOptions.initialFiles.length, 10);
    assert.ok(capturedOptions.initialFiles.includes('vite.config.ts'));
    assert.ok(capturedOptions.initialFiles.includes('src/components/component-0.tsx'));
    assert.match(capturedOptions.userMessage, /Files matching reviewer scope: 23/);
    assert.match(capturedOptions.userMessage, /Seed files provided for analysis: 10/);
  } finally {
    restoreApiKey();
  }
});

test('runAudit surfaces nested reviewer failure causes in persisted issues', async () => {
  const repoPath = makeRepo();
  const restoreApiKey = setApiKey('test-api-key');
  fs.mkdirSync(path.join(repoPath, '.codeowl', 'reviewers'), { recursive: true });
  fs.writeFileSync(
    path.join(repoPath, '.codeowl', 'reviewers', 'failing-reviewer.md'),
    `---
id: failing-reviewer
name: Failing Reviewer
mode: audit
---
Fail on purpose.
`,
  );

  try {
    const result = await runAudit(
      { repoPath, reviewerIds: ['failing-reviewer', 'code-quality'] },
      {
        getRuntime: async () => ({
          async runAgenticReview(options, schema) {
            if (options.callLabel === 'Failing Reviewer') {
              const cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:4096'), {
                code: 'ECONNREFUSED',
                syscall: 'connect',
                address: '127.0.0.1',
                port: 4096,
              });
              throw new Error('fetch failed', { cause });
            }

            return {
              data: schema.parse({ score: 85, summary: 'ok', findings: [] }),
              model: 'anthropic/mock-model',
              runtime: 'sdk',
              durationMs: 0,
              rawResponse: '',
            };
          },
          async run() {
            throw new Error('orchestrator runtime should not be used in this test');
          },
          async listModels() {
            return [];
          },
          async isAvailable() {
            return true;
          },
        }),
      },
    );

    assert.equal(result.status, 'degraded');
    assert.match(
      result.issues.find(issue => issue.code === 'audit-reviewer-failed').message,
      /ECONNREFUSED/,
    );
  } finally {
    restoreApiKey();
  }
});
