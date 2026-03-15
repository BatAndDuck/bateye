const test = require('node:test');
const assert = require('node:assert/strict');

const {
  prioritySchema,
  reviewerAnalysisSchema,
  systemSynthesisSchema,
  serviceDesignDocSchema,
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

// systemSynthesisSchema
test('systemSynthesisSchema accepts all valid architecture types', () => {
  const architectureTypes = [
    'monolith',
    'modular-monolith',
    'distributed-monolith',
    'microservices',
    'hybrid-service-oriented',
    'event-driven-hybrid',
  ];
  for (const archType of architectureTypes) {
    const result = systemSynthesisSchema.safeParse({
      architectureType: archType,
      score: 75,
      strengths: ['decoupled'],
      weaknesses: ['complex'],
      globalSummary: 'A summary.',
    });
    assert.ok(result.success, `Expected architecture type '${archType}' to be valid`);
  }
});

test('systemSynthesisSchema rejects unknown architecture type', () => {
  const result = systemSynthesisSchema.safeParse({
    architectureType: 'unknown-type',
    score: 75,
    strengths: [],
    weaknesses: [],
    globalSummary: 'Summary',
  });
  assert.ok(!result.success);
});

test('systemSynthesisSchema rejects score below 0', () => {
  const result = systemSynthesisSchema.safeParse({
    architectureType: 'monolith',
    score: -1,
    strengths: [],
    weaknesses: [],
    globalSummary: 'Summary',
  });
  assert.ok(!result.success);
});

test('systemSynthesisSchema rejects score above 100', () => {
  const result = systemSynthesisSchema.safeParse({
    architectureType: 'monolith',
    score: 101,
    strengths: [],
    weaknesses: [],
    globalSummary: 'Summary',
  });
  assert.ok(!result.success);
});

test('systemSynthesisSchema requires globalSummary', () => {
  const result = systemSynthesisSchema.safeParse({
    architectureType: 'monolith',
    score: 80,
    strengths: [],
    weaknesses: [],
  });
  assert.ok(!result.success);
});

// Minimal valid service document (used across multiple tests)
function makeValidService(overrides = {}) {
  return {
    serviceId: 'svc',
    name: 'svc',
    kind: 'service',
    purpose: 'A purpose',
    responsibilities: [],
    capabilities: [],
    publicInterfaces: [],
    integrations: [],
    dependencies: [],
    entities: [],
    submodules: [],
    complexityScore: 3,
    risks: [],
    ...overrides,
  };
}

// serviceDesignDocSchema
test('serviceDesignDocSchema accepts a fully valid service document', () => {
  const validService = makeValidService({
    serviceId: 'api-service',
    name: 'api-service',
    kind: 'service',
    purpose: 'Handles API requests',
    responsibilities: ['Route requests', 'Validate input'],
    capabilities: ['REST API', 'Rate limiting'],
    publicInterfaces: [
      { type: 'http', name: 'GET /health', description: 'Health check endpoint' },
    ],
    integrations: [
      { name: 'postgres', description: 'Primary datastore', internal: false, category: 'database' },
    ],
    dependencies: ['database'],
    entities: [{ name: 'User', description: 'User entity', fields: ['id', 'email'] }],
    submodules: ['routes', 'controllers'],
    complexityScore: 5,
    risks: ['Single point of failure'],
  });
  const result = serviceDesignDocSchema.safeParse(validService);
  assert.ok(result.success);
});

test('serviceDesignDocSchema accepts all valid service kinds', () => {
  const kinds = ['service', 'module', 'library', 'app', 'worker', 'gateway', 'resource'];
  for (const kind of kinds) {
    const result = serviceDesignDocSchema.safeParse(makeValidService({ kind }));
    assert.ok(result.success, `Expected kind '${kind}' to be valid`);
  }
});

test('serviceDesignDocSchema accepts optional resourceCategory', () => {
  const result = serviceDesignDocSchema.safeParse(
    makeValidService({ kind: 'resource', resourceCategory: 'database' }),
  );
  assert.ok(result.success);
});

test('serviceDesignDocSchema rejects invalid resourceCategory', () => {
  const result = serviceDesignDocSchema.safeParse(
    makeValidService({ kind: 'resource', resourceCategory: 'unknown-category' }),
  );
  assert.ok(!result.success);
});

test('serviceDesignDocSchema rejects invalid service kind', () => {
  const result = serviceDesignDocSchema.safeParse(makeValidService({ kind: 'database' }));
  assert.ok(!result.success);
});

test('serviceDesignDocSchema rejects missing capabilities field', () => {
  const svc = makeValidService();
  delete svc.capabilities;
  const result = serviceDesignDocSchema.safeParse(svc);
  assert.ok(!result.success);
});

test('serviceDesignDocSchema rejects missing integrations field', () => {
  const svc = makeValidService();
  delete svc.integrations;
  const result = serviceDesignDocSchema.safeParse(svc);
  assert.ok(!result.success);
});

test('serviceDesignDocSchema rejects complexityScore below 1', () => {
  const result = serviceDesignDocSchema.safeParse(makeValidService({ complexityScore: 0 }));
  assert.ok(!result.success);
});

test('serviceDesignDocSchema rejects complexityScore above 10', () => {
  const result = serviceDesignDocSchema.safeParse({
    serviceId: 'svc',
    name: 'svc',
    kind: 'service',
    purpose: 'Purpose',
    responsibilities: [],
    capabilities: [],
    publicInterfaces: [],
    integrations: [],
    dependencies: [],
    entities: [],
    submodules: [],
    complexityScore: 11,
    risks: [],
  });
  assert.ok(!result.success);
});

test('serviceDesignDocSchema rejects invalid public interface type', () => {
  const result = serviceDesignDocSchema.safeParse(
    makeValidService({ publicInterfaces: [{ type: 'rest', name: 'GET /foo' }] }),
  );
  assert.ok(!result.success);
});

// orchestratorResultSchema
test('orchestratorResultSchema accepts valid data with reviewers', () => {
  const result = orchestratorResultSchema.safeParse({
    selectedReviewers: [
      { reviewerId: 'code-quality', reason: 'Relevant for this PR' },
      { reviewerId: 'security-api', reason: 'API changes detected' },
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
