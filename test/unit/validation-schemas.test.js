const test = require('node:test');
const assert = require('node:assert/strict');

const {
  prioritySchema,
  reviewerAnalysisSchema,
  orchestratorResultSchema,
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
    selectedReviewers: [
      { reviewerId: 'code-quality', reason: 'Relevant for this PR', confidence: 0.95 },
      { reviewerId: 'security-api', reason: 'API changes detected', confidence: 0.8 },
    ],
  });
  assert.ok(result.success);
});

test('orchestratorResultSchema accepts empty reviewer list', () => {
  const result = orchestratorResultSchema.safeParse({ selectedReviewers: [] });
  assert.ok(result.success);
});

test('orchestratorResultSchema rejects missing selectedReviewers', () => {
  const result = orchestratorResultSchema.safeParse({});
  assert.ok(!result.success);
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
