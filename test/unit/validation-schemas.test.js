const test = require('node:test');
const assert = require('node:assert/strict');

const {
  prioritySchema,
  reviewerAnalysisSchema,
  orchestratorResultSchema,
  prBundleAnalysisSchema,
} = require('../../dist/core/validation/schemas');

// prioritySchema
test('prioritySchema accepts all valid priority values', () => {
  for (const priority of ['critical', 'high', 'medium', 'low', 'info']) {
    const result = prioritySchema.safeParse(priority);
    assert.ok(result.success, `Expected '${priority}' to be valid`);
  }
});

test('prioritySchema rejects invalid priority strings', () => {
  for (const invalid of ['urgent', 'normal', 'CRITICAL', '']) {
    const result = prioritySchema.safeParse(invalid);
    assert.ok(!result.success, `Expected '${invalid}' to be invalid`);
  }
});

// orchestratorResultSchema
test('orchestratorResultSchema accepts valid data with reviewers', () => {
  const result = orchestratorResultSchema.safeParse({
    intentSummary: 'The PR updates application logic and intentionally changes reviewer routing behavior.',
    selectedReviewers: [
      { reviewerId: 'code-quality', reason: 'Relevant for this PR', confidence: 0.95 },
      { reviewerId: 'security-api', reason: 'API changes detected', confidence: 0.8 },
    ],
  });
  assert.ok(result.success);
});

test('orchestratorResultSchema accepts empty reviewer list', () => {
  const result = orchestratorResultSchema.safeParse({
    intentSummary: 'The diff is documentation-only, so no specialist reviewers are needed.',
    selectedReviewers: [],
  });
  assert.ok(result.success);
});

test('orchestratorResultSchema rejects missing selectedReviewers or intentSummary', () => {
  const result = orchestratorResultSchema.safeParse({});
  assert.ok(!result.success);
  assert.equal(result.error.issues.some(issue => issue.path.join('.') === 'selectedReviewers'), true);
  assert.equal(result.error.issues.some(issue => issue.path.join('.') === 'intentSummary'), true);
});

// reviewerAnalysisSchema
test('reviewerAnalysisSchema accepts valid analysis with empty findings', () => {
  const result = reviewerAnalysisSchema.safeParse({
    score: 85,
    summary: 'Code is clean and well-structured.',
    findings: [],
  });
  assert.ok(result.success);
});

test('reviewerAnalysisSchema accepts analysis with findings', () => {
  const result = reviewerAnalysisSchema.safeParse({
    score: 60,
    summary: 'Several issues found.',
    findings: [
      {
        id: 'finding-1',
        title: 'Missing input validation',
        description: 'User input is not validated.',
        priority: 'high',
        confidence: 0.9,
        filePath: 'src/api.ts',
        startLine: 10,
        endLine: 15,
        evidence: ['Line 10: req.body.name used directly'],
        recommendation: 'Add validation with zod.',
      },
    ],
  });
  assert.ok(result.success);
});

test('reviewerAnalysisSchema rejects score below 0', () => {
  const result = reviewerAnalysisSchema.safeParse({
    score: -5,
    summary: 'Summary',
    findings: [],
  });
  assert.ok(!result.success);
});

test('reviewerAnalysisSchema rejects score above 100', () => {
  const result = reviewerAnalysisSchema.safeParse({
    score: 105,
    summary: 'Summary',
    findings: [],
  });
  assert.ok(!result.success);
});

test('reviewerAnalysisSchema rejects finding with confidence out of [0,1]', () => {
  const result = reviewerAnalysisSchema.safeParse({
    score: 80,
    summary: 'Summary',
    findings: [
      {
        id: 'f1',
        title: 'Issue',
        description: 'Desc',
        priority: 'medium',
        confidence: 1.5,
        filePath: 'src/foo.ts',
        startLine: 1,
        endLine: 1,
        evidence: [],
        recommendation: 'Fix it',
      },
    ],
  });
  assert.ok(!result.success);
});

test('reviewerAnalysisSchema rejects findings where endLine is before startLine', () => {
  const result = reviewerAnalysisSchema.safeParse({
    score: 80,
    summary: 'Summary',
    findings: [
      {
        id: 'f1',
        title: 'Issue',
        description: 'Desc',
        priority: 'medium',
        confidence: 0.8,
        filePath: 'src/foo.ts',
        startLine: 10,
        endLine: 5,
        evidence: [],
        recommendation: 'Fix it',
      },
    ],
  });
  assert.ok(!result.success);
});

test('reviewerAnalysisSchema rejects findings with startLine = 0 (must be >= 1)', () => {
  const result = reviewerAnalysisSchema.safeParse({
    score: 80,
    summary: 'Summary',
    findings: [
      {
        id: 'f1',
        title: 'Issue',
        description: 'Desc',
        priority: 'medium',
        confidence: 0.8,
        filePath: 'src/foo.ts',
        startLine: 0,
        endLine: 1,
        evidence: [],
        recommendation: 'Fix it',
      },
    ],
  });
  assert.ok(!result.success);
});

test('reviewerAnalysisSchema rejects findings with endLine = 0 (must be >= 1)', () => {
  const result = reviewerAnalysisSchema.safeParse({
    score: 80,
    summary: 'Summary',
    findings: [
      {
        id: 'f1',
        title: 'Issue',
        description: 'Desc',
        priority: 'medium',
        confidence: 0.8,
        filePath: 'src/foo.ts',
        startLine: 1,
        endLine: 0,
        evidence: [],
        recommendation: 'Fix it',
      },
    ],
  });
  assert.ok(!result.success);
});

// orchestratorResultSchema - executionPlan
test('orchestratorResultSchema accepts a payload without executionPlan (backward compatible)', () => {
  const result = orchestratorResultSchema.safeParse({
    intentSummary: 'No plan provided.',
    selectedReviewers: [
      { reviewerId: 'code-quality', reason: 'Always relevant', confidence: 0.9 },
    ],
  });
  assert.ok(result.success);
  assert.equal(result.data.executionPlan, undefined);
});

test('orchestratorResultSchema accepts a valid executionPlan with standard and deep groups', () => {
  const result = orchestratorResultSchema.safeParse({
    intentSummary: 'Adds auth and refactors API.',
    selectedReviewers: [
      { reviewerId: 'secret-scan', reason: 'sensitive paths', confidence: 0.9 },
      { reviewerId: 'code-quality', reason: 'broad refactor', confidence: 0.85 },
    ],
    executionPlan: [
      { groupId: 'security', mode: 'deep', reason: 'sensitive auth logic', reviewerIds: ['secret-scan'] },
      { groupId: 'correctness', mode: 'standard', reason: 'runtime paths', reviewerIds: ['code-quality'] },
    ],
  });
  assert.ok(result.success);
  assert.equal(result.data.executionPlan.length, 2);
  assert.equal(result.data.executionPlan[0].mode, 'deep');
});

test('orchestratorResultSchema defaults executionPlan group mode to standard when omitted', () => {
  const result = orchestratorResultSchema.safeParse({
    intentSummary: 'plan without explicit mode',
    selectedReviewers: [
      { reviewerId: 'code-quality', reason: 'default case', confidence: 0.9 },
    ],
    executionPlan: [
      { groupId: 'correctness', reason: 'runtime paths', reviewerIds: ['code-quality'] },
    ],
  });
  assert.ok(result.success);
  assert.equal(result.data.executionPlan[0].mode, 'standard');
});

test('orchestratorResultSchema rejects executionPlan group with empty reviewerIds', () => {
  const result = orchestratorResultSchema.safeParse({
    intentSummary: 'invalid plan',
    selectedReviewers: [],
    executionPlan: [
      { groupId: 'empty', mode: 'standard', reason: 'placeholder', reviewerIds: [] },
    ],
  });
  assert.ok(!result.success);
});

test('orchestratorResultSchema rejects executionPlan group with unknown mode', () => {
  const result = orchestratorResultSchema.safeParse({
    intentSummary: 'invalid mode',
    selectedReviewers: [
      { reviewerId: 'code-quality', reason: 'x', confidence: 0.9 },
    ],
    executionPlan: [
      { groupId: 'correctness', mode: 'lightning', reason: 'x', reviewerIds: ['code-quality'] },
    ],
  });
  assert.ok(!result.success);
});

// prBundleAnalysisSchema
function makeBundleFinding(overrides = {}) {
  return {
    id: 'BUNDLE_1',
    reviewerId: 'code-quality',
    title: 'Issue',
    description: 'Desc',
    priority: 'medium',
    confidence: 0.85,
    filePath: 'src/foo.ts',
    startLine: 10,
    endLine: 12,
    codeQuote: 'const x = 1;',
    evidence: ['line 10 adds an unused constant'],
    verificationTrail: ['file:src/foo.ts'],
    recommendation: 'Remove the unused constant.',
    ...overrides,
  };
}

test('prBundleAnalysisSchema accepts a valid bundle with per-reviewer entries and findings', () => {
  const result = prBundleAnalysisSchema.safeParse({
    perReviewer: [
      { reviewerId: 'code-quality', score: 80, summary: 'One finding.' },
      { reviewerId: 'bug-hunter', score: 100, summary: '' },
    ],
    findings: [
      makeBundleFinding(),
    ],
  });
  assert.ok(result.success);
});

test('prBundleAnalysisSchema accepts a bundle with zero findings', () => {
  const result = prBundleAnalysisSchema.safeParse({
    perReviewer: [
      { reviewerId: 'code-quality', score: 100, summary: '' },
    ],
    findings: [],
  });
  assert.ok(result.success);
});

test('prBundleAnalysisSchema rejects a bundle finding missing reviewerId', () => {
  const finding = makeBundleFinding();
  delete finding.reviewerId;
  const result = prBundleAnalysisSchema.safeParse({
    perReviewer: [
      { reviewerId: 'code-quality', score: 80, summary: 'x' },
    ],
    findings: [finding],
  });
  assert.ok(!result.success);
});

test('prBundleAnalysisSchema rejects a bundle finding with empty reviewerId', () => {
  const result = prBundleAnalysisSchema.safeParse({
    perReviewer: [
      { reviewerId: 'code-quality', score: 80, summary: 'x' },
    ],
    findings: [makeBundleFinding({ reviewerId: '' })],
  });
  assert.ok(!result.success);
});

test('prBundleAnalysisSchema rejects a bundle finding with empty codeQuote', () => {
  const result = prBundleAnalysisSchema.safeParse({
    perReviewer: [
      { reviewerId: 'code-quality', score: 80, summary: 'x' },
    ],
    findings: [makeBundleFinding({ codeQuote: '' })],
  });
  assert.ok(!result.success);
});

test('prBundleAnalysisSchema rejects a bundle finding with empty verificationTrail', () => {
  const result = prBundleAnalysisSchema.safeParse({
    perReviewer: [
      { reviewerId: 'code-quality', score: 80, summary: 'x' },
    ],
    findings: [makeBundleFinding({ verificationTrail: [] })],
  });
  assert.ok(!result.success);
});

test('prBundleAnalysisSchema rejects a bundle finding with more than 5 verificationTrail entries', () => {
  const result = prBundleAnalysisSchema.safeParse({
    perReviewer: [
      { reviewerId: 'code-quality', score: 80, summary: 'x' },
    ],
    findings: [
      makeBundleFinding({
        verificationTrail: [
          'file:a.ts', 'file:b.ts', 'file:c.ts', 'file:d.ts', 'file:e.ts', 'file:f.ts',
        ],
      }),
    ],
  });
  assert.ok(!result.success);
});

test('prBundleAnalysisSchema rejects perReviewer entry with empty reviewerId', () => {
  const result = prBundleAnalysisSchema.safeParse({
    perReviewer: [
      { reviewerId: '', score: 80, summary: 'x' },
    ],
    findings: [],
  });
  assert.ok(!result.success);
});

test('prBundleAnalysisSchema rejects perReviewer score out of range', () => {
  const result = prBundleAnalysisSchema.safeParse({
    perReviewer: [
      { reviewerId: 'code-quality', score: 120, summary: 'x' },
    ],
    findings: [],
  });
  assert.ok(!result.success);
});

test('prBundleAnalysisSchema rejects bundle finding where endLine < startLine', () => {
  const result = prBundleAnalysisSchema.safeParse({
    perReviewer: [
      { reviewerId: 'code-quality', score: 80, summary: 'x' },
    ],
    findings: [makeBundleFinding({ startLine: 20, endLine: 10 })],
  });
  assert.ok(!result.success);
});
