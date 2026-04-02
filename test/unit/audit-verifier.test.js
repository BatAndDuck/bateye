const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { verifyAuditFindings } = require('../../dist/features/audit/application/audit-verifier');

function makeRepo() {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-audit-verifier-'));
  fs.mkdirSync(path.join(repoPath, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(repoPath, 'src', 'sample.ts'),
    [
      'export function sample(value: string): string {',
      '  const normalized = value.trim();',
      '  return normalized;',
      '}',
      '',
    ].join('\n'),
    'utf-8',
  );
  return repoPath;
}

function makeFinding() {
  return {
    id: 'AUDIT-001',
    reviewerId: 'security-api',
    reviewerName: 'API Security',
    title: 'Example finding',
    description: 'Investigate sample behavior.',
    priority: 'high',
    confidence: 0.9,
    filePath: 'src/sample.ts',
    startLine: 1,
    endLine: 3,
    evidence: ['export function sample(value: string): string {'],
    recommendation: 'Review sample().',
  };
}

test('verifyAuditFindings passes explicit timeout and small output budget to the runtime', async () => {
  const repoPath = makeRepo();
  const calls = [];

  const runtime = {
    async run(options) {
      calls.push(options);
      return {
        data: {
          verifications: [
            { findingId: 'AUDIT-001', classification: 'concrete', reason: 'Confirmed.' },
          ],
        },
        model: options.model,
        runtime: 'sdk',
        durationMs: 10,
        rawResponse: '{}',
      };
    },
  };

  const result = await verifyAuditFindings([makeFinding()], {
    repoPath,
    model: 'openai/gpt-5.4-nano',
    apiKey: 'sk-test',
    runtime,
  });

  assert.equal(result.kept.length, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].timeoutMs, 180000);
  assert.equal(calls[0].maxTokens, 1024);
  assert.equal(calls[0].temperature, 0);
  assert.equal(calls[0].cwd, repoPath);
});

test('verifyAuditFindings writes prompt captures when diagnostic mode is enabled', async () => {
  const repoPath = makeRepo();
  const diagnosticDir = path.join(repoPath, '.bateye', 'out', 'diagnostics-test');
  const originalDiagnostic = process.env.BATEYE_DIAGNOSTIC;
  const originalDiagnosticDir = process.env.BATEYE_DIAGNOSTIC_DIR;
  process.env.BATEYE_DIAGNOSTIC = '1';
  process.env.BATEYE_DIAGNOSTIC_DIR = diagnosticDir;

  try {
    const runtime = {
      async run(options) {
        return {
          data: {
            verifications: [
              { findingId: 'AUDIT-001', classification: 'concrete', reason: 'Confirmed.' },
            ],
          },
          model: options.model,
          runtime: 'sdk',
          durationMs: 10,
          rawResponse: '{}',
        };
      },
    };

    await verifyAuditFindings([makeFinding()], {
      repoPath,
      model: 'openai/gpt-5.4-nano',
      apiKey: 'sk-test',
      runtime,
    });

    const files = fs.readdirSync(diagnosticDir);
    assert.ok(files.some(file => file.includes('audit-verifier-batch1-system')));
    assert.ok(files.some(file => file.includes('audit-verifier-batch1-user')));
  } finally {
    if (originalDiagnostic === undefined) delete process.env.BATEYE_DIAGNOSTIC;
    else process.env.BATEYE_DIAGNOSTIC = originalDiagnostic;

    if (originalDiagnosticDir === undefined) delete process.env.BATEYE_DIAGNOSTIC_DIR;
    else process.env.BATEYE_DIAGNOSTIC_DIR = originalDiagnosticDir;
  }
});
