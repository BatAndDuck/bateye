const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildOpenCodeFetchInit,
  buildStructuredOutputSchema,
  extractStructuredOutput,
  coerceReviewerPayload,
  repairReviewerPayload,
  serializeOpenCodeResponse,
  stripThinkingSuffix,
} = require('../../dist/core/runtime/opencode-cli/index');
const {
  reviewerAnalysisSchema,
} = require('../../dist/core/validation/schemas');

test('buildStructuredOutputSchema emits a direct object schema without top-level refs', () => {
  const schema = buildStructuredOutputSchema(reviewerAnalysisSchema);

  assert.equal(schema.type, 'object');
  assert.deepEqual(schema.required, ['score', 'summary', 'findings']);
  assert.equal(schema.$ref, undefined);
  assert.equal(schema.$schema, undefined);
  assert.equal(schema.definitions, undefined);
});

test('buildOpenCodeFetchInit attaches the dedicated OpenCode dispatcher without mutating global fetch defaults', () => {
  const controller = new AbortController();
  const init = buildOpenCodeFetchInit({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  }, controller.signal);

  assert.equal(init.method, 'POST');
  assert.deepEqual(init.headers, { 'content-type': 'application/json' });
  assert.equal(init.signal, controller.signal);
  assert.ok(init.dispatcher);
  assert.equal(typeof init.dispatcher.dispatch, 'function');
});

test('extractStructuredOutput supports the documented structured_output field', () => {
  const response = {
    info: {
      structured_output: {
        score: 100,
        summary: 'ok',
        findings: [],
      },
    },
    parts: [],
  };

  assert.deepEqual(extractStructuredOutput(response), {
    score: 100,
    summary: 'ok',
    findings: [],
  });
});

test('serializeOpenCodeResponse prefers structured output over text parts', () => {
  const response = {
    info: {
      structured: {
        score: 100,
        summary: 'ok',
        findings: [],
      },
    },
    parts: [
      { type: 'text', text: 'This text should be ignored in favor of structured output.' },
    ],
  };

  assert.equal(
    serializeOpenCodeResponse(response),
    JSON.stringify({ score: 100, summary: 'ok', findings: [] }),
  );
});

test('coerceReviewerPayload normalizes stringified structured fields from OpenCode', () => {
  const coerced = coerceReviewerPayload({
    score: '100',
    summary: 'ok',
    findings: '[]',
  });

  assert.deepEqual(coerced, {
    score: 100,
    summary: 'ok',
    findings: [],
  });
});

test('repairReviewerPayload fills common reviewer field aliases', () => {
  const repaired = repairReviewerPayload({
    score: 80,
    summary: 'ok',
    findings: [
      {
        id: 'f-1',
        issue: 'Derived title',
        details: 'Detailed description of the issue.',
        severity: 'warning',
        certainty: '0.8',
        file: 'src/index.ts',
        line: '12',
        examples: 'evidence line',
        suggestion: 'Fix it',
      },
    ],
  });

  assert.deepEqual(repaired, {
    score: 80,
    summary: 'ok',
    findings: [
      {
        id: 'f-1',
        issue: 'Derived title',
        details: 'Detailed description of the issue.',
        severity: 'warning',
        certainty: '0.8',
        file: 'src/index.ts',
        line: '12',
        examples: 'evidence line',
        suggestion: 'Fix it',
        title: 'Derived title',
        description: 'Detailed description of the issue.',
        priority: 'medium',
        confidence: 0.8,
        filePath: 'src/index.ts',
        startLine: 12,
        endLine: 12,
        evidence: ['evidence line'],
        recommendation: 'Fix it',
      },
    ],
  });
});

test('repairReviewerPayload normalizes inverted line and column ranges', () => {
  const repaired = repairReviewerPayload({
    score: 70,
    summary: 'ok',
    findings: [
      {
        id: 'f-2',
        title: 'Range issue',
        description: 'Range issue description.',
        priority: 'high',
        confidence: 0.9,
        filePath: 'src/index.ts',
        startLine: 20,
        endLine: 10,
        startColumn: 8,
        endColumn: 3,
        evidence: ['x'],
        recommendation: 'Fix it',
      },
    ],
  });

  assert.deepEqual(repaired.findings[0].startLine, 10);
  assert.deepEqual(repaired.findings[0].endLine, 20);
  assert.deepEqual(repaired.findings[0].startColumn, 3);
  assert.deepEqual(repaired.findings[0].endColumn, 8);
});

// ─── stripThinkingSuffix ────────────────────────────────────────────────────
// DeepSeek "thinking" variants require reasoning_content in every tool-call
// turn, which OpenCode does not inject.  The helper strips the suffix so the
// compatible non-thinking sibling model is used automatically.

test('stripThinkingSuffix removes -thinking suffix from a thinking model ID', () => {
  assert.equal(stripThinkingSuffix('deepseek-v3.2-thinking'), 'deepseek-v3.2');
});

test('stripThinkingSuffix leaves non-thinking model IDs unchanged', () => {
  assert.equal(stripThinkingSuffix('deepseek-v3.2'), 'deepseek-v3.2');
});

test('stripThinkingSuffix leaves unrelated model IDs unchanged', () => {
  assert.equal(stripThinkingSuffix('claude-sonnet-4-5'), 'claude-sonnet-4-5');
  assert.equal(stripThinkingSuffix('gpt-4o'), 'gpt-4o');
  assert.equal(stripThinkingSuffix('gemini-2.0-flash'), 'gemini-2.0-flash');
});

test('stripThinkingSuffix only strips a trailing -thinking, not one in the middle', () => {
  // Hypothetical: a model with "thinking" elsewhere in the name should not be modified.
  assert.equal(stripThinkingSuffix('my-thinking-model'), 'my-thinking-model');
});

test('stripThinkingSuffix handles the empty string without throwing', () => {
  assert.equal(stripThinkingSuffix(''), '');
});
