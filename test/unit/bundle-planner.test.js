const test = require('node:test');
const assert = require('node:assert/strict');

const { buildExecutionPlan } = require('../../dist/core/pr-review/bundle-planner');

function reviewer(id, overrides = {}) {
  return {
    id,
    name: id,
    description: `${id} reviewer`,
    instructions: 'noop',
    sourcePath: `/fake/${id}.md`,
    isBuiltIn: true,
    ...overrides,
  };
}

test('fallback plan groups built-in reviewers by category bundle', () => {
  const selected = [
    reviewer('secret-scan', { category: 'security' }),
    reviewer('dep-audit', { category: 'dependency' }),
    reviewer('code-quality', { category: 'code-quality' }),
    reviewer('bug-hunter', { category: 'qa' }),
  ];

  const groups = buildExecutionPlan(selected, undefined);

  const securityGroup = groups.find(g => g.groupId === 'security');
  const correctnessGroup = groups.find(g => g.groupId === 'correctness');

  assert.ok(securityGroup, 'security bundle should exist');
  assert.equal(securityGroup.reviewers.length, 2);
  assert.deepEqual(
    securityGroup.reviewers.map(r => r.id).sort(),
    ['dep-audit', 'secret-scan'],
  );

  assert.ok(correctnessGroup, 'correctness bundle should exist');
  assert.deepEqual(
    correctnessGroup.reviewers.map(r => r.id).sort(),
    ['bug-hunter', 'code-quality'],
  );
});

test('fallback plan isolates reviewers with a tool override', () => {
  const selected = [
    reviewer('code-quality', { category: 'code-quality' }),
    reviewer('semgrep', {
      category: 'security',
      tool: { command: 'semgrep', args: [], targeting: 'file' },
    }),
  ];

  const groups = buildExecutionPlan(selected, undefined);

  const semgrepGroup = groups.find(g => g.reviewers.some(r => r.id === 'semgrep'));
  assert.ok(semgrepGroup);
  assert.equal(semgrepGroup.reviewers.length, 1, 'tool reviewers must be isolated');
});

test('fallback plan isolates reviewers with an uncategorized slot', () => {
  const selected = [
    reviewer('mystery', { category: undefined }),
    reviewer('code-quality', { category: 'code-quality' }),
  ];

  const groups = buildExecutionPlan(selected, undefined);
  const mysteryGroup = groups.find(g => g.reviewers.some(r => r.id === 'mystery'));
  assert.ok(mysteryGroup);
  assert.equal(mysteryGroup.reviewers.length, 1);
  assert.equal(mysteryGroup.groupId, 'mystery');
});

test('custom reviewers without tool/model merge into matching category bundle', () => {
  const selected = [
    reviewer('secret-scan', { category: 'security' }),
    reviewer('custom-auth', { category: 'security', isBuiltIn: false }),
  ];

  const groups = buildExecutionPlan(selected, undefined);
  const securityGroup = groups.find(g => g.groupId === 'security');
  assert.ok(securityGroup);
  assert.equal(securityGroup.reviewers.length, 2);
  assert.ok(securityGroup.reviewers.some(r => r.id === 'custom-auth'));
});

test('custom reviewer with tool stays isolated even if category matches', () => {
  const selected = [
    reviewer('secret-scan', { category: 'security' }),
    reviewer('custom-semgrep', {
      category: 'security',
      isBuiltIn: false,
      tool: { command: 'semgrep', args: [], targeting: 'file' },
    }),
  ];

  const groups = buildExecutionPlan(selected, undefined);
  const semgrepGroup = groups.find(g => g.reviewers.some(r => r.id === 'custom-semgrep'));
  assert.ok(semgrepGroup);
  assert.equal(semgrepGroup.reviewers.length, 1);
});

test('orchestrator plan is honored but safety-split on conflicting model overrides', () => {
  const selected = [
    reviewer('code-quality', { category: 'code-quality' }),
    reviewer('bug-hunter', {
      category: 'qa',
      model: 'anthropic/claude-opus-4-6',
    }),
  ];
  const orchestratorPlan = [
    {
      groupId: 'correctness',
      mode: 'standard',
      reason: 'Both inspect runtime correctness',
      reviewerIds: ['code-quality', 'bug-hunter'],
    },
  ];

  const groups = buildExecutionPlan(selected, orchestratorPlan);
  // Safety split keeps one reviewer with the first one and isolates the other.
  const total = groups.reduce((sum, g) => sum + g.reviewers.length, 0);
  assert.equal(total, 2);
  assert.ok(groups.length >= 2, 'planner should split reviewers with different model overrides');
});

test('orchestrator plan honors tool-reviewer isolation even when merged', () => {
  const selected = [
    reviewer('code-quality', { category: 'code-quality' }),
    reviewer('semgrep', {
      category: 'security',
      tool: { command: 'semgrep', args: [], targeting: 'file' },
    }),
  ];
  const orchestratorPlan = [
    {
      groupId: 'mega',
      mode: 'standard',
      reason: 'bundle everything together',
      reviewerIds: ['code-quality', 'semgrep'],
    },
  ];

  const groups = buildExecutionPlan(selected, orchestratorPlan);
  const semgrepGroup = groups.find(g => g.reviewers.some(r => r.id === 'semgrep'));
  assert.ok(semgrepGroup);
  assert.equal(semgrepGroup.reviewers.length, 1);
});

test('reviewers missing from orchestrator plan are placed in isolated fallback groups', () => {
  const selected = [
    reviewer('code-quality', { category: 'code-quality' }),
    reviewer('bug-hunter', { category: 'qa' }),
    reviewer('orphan', { category: 'ux' }),
  ];
  const orchestratorPlan = [
    {
      groupId: 'correctness',
      mode: 'standard',
      reason: 'share runtime paths',
      reviewerIds: ['code-quality', 'bug-hunter'],
    },
  ];

  const groups = buildExecutionPlan(selected, orchestratorPlan);
  const orphanGroup = groups.find(g => g.reviewers.some(r => r.id === 'orphan'));
  assert.ok(orphanGroup, 'orphan should never be silently dropped');
  assert.equal(orphanGroup.reviewers.length, 1);
});

test('empty selection produces empty plan', () => {
  assert.deepEqual(buildExecutionPlan([], undefined), []);
  assert.deepEqual(buildExecutionPlan([], []), []);
});
