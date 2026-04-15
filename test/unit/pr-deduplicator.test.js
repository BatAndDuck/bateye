const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildFindingDedupPlan,
  deduplicateFindings,
  mergeDuplicateFindings,
} = require('../../dist/core/pr-review/deduplicator');

function makeFinding(overrides = {}) {
  return {
    id: overrides.id || 'F1',
    reviewerId: overrides.reviewerId || 'reviewer-a',
    reviewerName: overrides.reviewerName || 'Reviewer A',
    title: overrides.title || 'Default finding title',
    description: overrides.description || 'Default finding description.',
    priority: overrides.priority || 'high',
    confidence: overrides.confidence ?? 0.9,
    filePath: overrides.filePath || 'src/service.ts',
    startLine: overrides.startLine || 10,
    endLine: overrides.endLine || overrides.startLine || 10,
    codeQuote: overrides.codeQuote || 'const normalized = input.trim();',
    evidence: overrides.evidence || ['default evidence'],
    verificationTrail: overrides.verificationTrail || ['file:src/service.ts'],
    searchedFor: overrides.searchedFor || ['default-search'],
    recommendation: overrides.recommendation || 'Default recommendation.',
    tags: overrides.tags || ['default'],
  };
}

test('buildFindingDedupPlan keeps same-line distinct issues ambiguous instead of obvious duplicates', () => {
  const a = makeFinding({
    id: 'A',
    reviewerId: 'logging',
    reviewerName: 'Logging',
    title: 'Logs part of the token in fallback warning',
    description: 'The warning string interpolates a token fragment directly.',
    codeQuote: 'console.warn(`fallback ${token.slice(0, 8)}`);',
    recommendation: 'Remove the token fragment from the warning.',
  });
  const b = makeFinding({
    id: 'B',
    reviewerId: 'resiliency',
    reviewerName: 'Resiliency',
    title: 'Inline fallback path lacks retry protection',
    description: 'The same fallback path performs a network operation without retry or backoff.',
    codeQuote: 'console.warn(`fallback ${token.slice(0, 8)}`);',
    recommendation: 'Wrap the fallback path in a retry-aware helper.',
  });

  const plan = buildFindingDedupPlan([a, b]);
  assert.equal(plan.obviousDecisions.length, 0);
  assert.equal(plan.ambiguousCandidates.length, 1);
  assert.equal(plan.ambiguousCandidates[0].sameAnchor, true);
  assert.equal(plan.ambiguousCandidates[0].codeQuoteOverlap, true);
});

test('deduplicateFindings still merges obvious duplicate paraphrases deterministically', () => {
  const a = makeFinding({
    id: 'A',
    title: 'Missing token validation on return path',
    description: 'The changed helper returns the token without validation.',
    recommendation: 'Validate the token before returning it.',
  });
  const b = makeFinding({
    id: 'B',
    reviewerId: 'reviewer-b',
    reviewerName: 'Reviewer B',
    title: 'Missing token validation in return path',
    description: 'The helper returns the token directly without validation.',
    recommendation: 'Add token validation before the return statement.',
    evidence: ['secondary evidence'],
    verificationTrail: ['search:return token'],
    searchedFor: ['token validation'],
    tags: ['security'],
  });

  const deduped = deduplicateFindings([a, b]);
  assert.equal(deduped.length, 1);
  assert.match(deduped[0].reviewerId, /reviewer-a/);
  assert.match(deduped[0].reviewerId, /reviewer-b/);
  assert.deepEqual(
    new Set(deduped[0].verificationTrail),
    new Set(['file:src/service.ts', 'search:return token']),
  );
});

test('mergeDuplicateFindings keeps both findings when the arbiter marks them distinct', () => {
  const a = makeFinding({ id: 'A' });
  const b = makeFinding({
    id: 'B',
    reviewerId: 'reviewer-b',
    reviewerName: 'Reviewer B',
    title: 'Different issue on the same line',
  });

  const merged = mergeDuplicateFindings([a, b], [
    {
      aId: 'A',
      bId: 'B',
      verdict: 'distinct',
      confidence: 0.92,
      rationale: 'Different failure modes despite the shared line.',
      source: 'llm',
    },
  ]);

  assert.equal(merged.length, 2);
  assert.deepEqual(merged.map(item => item.id), ['A', 'B']);
});
