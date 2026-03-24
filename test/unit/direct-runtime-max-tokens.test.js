/**
 * Tests for the max_completion_tokens fallback behaviour introduced to support
 * OpenAI reasoning models (o1, o3, gpt-5.x-nano, etc.) that reject max_tokens.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// ---------------------------------------------------------------------------
// Unit tests for the exported detection helper
// ---------------------------------------------------------------------------

const { shouldRetryWithMaxCompletionTokens } = require('../../dist/core/runtime/direct/index');

test('shouldRetryWithMaxCompletionTokens: detects error by error.param field', () => {
  const err = { status: 400, error: { param: 'max_tokens', message: 'not supported' } };
  assert.equal(shouldRetryWithMaxCompletionTokens(err), true);
});

test('shouldRetryWithMaxCompletionTokens: detects error by top-level message', () => {
  const err = {
    status: 400,
    message: "400 Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
  };
  assert.equal(shouldRetryWithMaxCompletionTokens(err), true);
});

test('shouldRetryWithMaxCompletionTokens: detects error by error.message field', () => {
  const err = {
    status: 400,
    error: { message: "'max_tokens' is not supported with this model" },
  };
  assert.equal(shouldRetryWithMaxCompletionTokens(err), true);
});

test('shouldRetryWithMaxCompletionTokens: does not trigger for response_format errors', () => {
  const err = { status: 400, error: { param: 'response_format', message: 'not supported' } };
  assert.equal(shouldRetryWithMaxCompletionTokens(err), false);
});

test('shouldRetryWithMaxCompletionTokens: does not trigger for non-400 status', () => {
  const err = { status: 500, error: { param: 'max_tokens' } };
  assert.equal(shouldRetryWithMaxCompletionTokens(err), false);
});

test('shouldRetryWithMaxCompletionTokens: does not trigger for unrelated 400', () => {
  const err = { status: 400, message: 'Invalid API key' };
  assert.equal(shouldRetryWithMaxCompletionTokens(err), false);
});

test('shouldRetryWithMaxCompletionTokens: handles null/undefined gracefully', () => {
  assert.equal(shouldRetryWithMaxCompletionTokens(null), false);
  assert.equal(shouldRetryWithMaxCompletionTokens(undefined), false);
  assert.equal(shouldRetryWithMaxCompletionTokens(new Error('boom')), false);
});

// ---------------------------------------------------------------------------
// Integration test: DirectAIRuntime retries with max_completion_tokens
// ---------------------------------------------------------------------------

test('DirectAIRuntime.run retries with max_completion_tokens when max_tokens is rejected', async () => {
  const originalLoad = Module._load.bind(Module);
  const callLog = [];

  // Build a mock OpenAI class whose chat.completions.create records params and
  // throws a max_tokens error on the first call, then succeeds.
  class MockOpenAI {
    constructor() {
      this.chat = {
        completions: {
          create: async (params) => {
            callLog.push({ ...params });
            if (callLog.length === 1) {
              // Simulate the error returned by reasoning models
              const err = new Error(
                "400 Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead."
              );
              err.status = 400;
              err.error = {
                param: 'max_tokens',
                message: "'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
              };
              throw err;
            }
            // Second call succeeds
            return {
              choices: [{ message: { content: '{"reviewers":["security-api"]}' } }],
              usage: { prompt_tokens: 10, completion_tokens: 20 },
            };
          },
        },
      };
    }
  }
  // MockOpenAI needs a default export as well (openai package uses default export)
  MockOpenAI.default = MockOpenAI;

  // Intercept require('openai') so the runtime uses our mock
  Module._load = function (request, parent, isMain) {
    if (request === 'openai') return MockOpenAI;
    return originalLoad(request, parent, isMain);
  };

  // Evict the cached runtime module so it re-requires 'openai' with the mock
  const runtimeKey = require.resolve('../../dist/core/runtime/direct/index');
  delete require.cache[runtimeKey];

  try {
    const { DirectAIRuntime } = require('../../dist/core/runtime/direct/index');
    const runtime = new DirectAIRuntime();
    const { z } = require('zod');

    const schema = z.object({ reviewers: z.array(z.string()) });
    const result = await runtime.run(
      {
        model: 'openai/gpt-5.4-nano',
        apiKey: 'sk-test-fake-key',
        systemPrompt: 'You are a reviewer selector.',
        userMessage: 'Pick reviewers for this diff.',
        maxTokens: 1024,
      },
      schema
    );

    // Two calls were made: first with max_tokens (failed), second with max_completion_tokens
    assert.equal(callLog.length, 2, 'expected exactly 2 calls to completions.create');

    // First call used max_tokens (the original attempt)
    assert.ok('max_tokens' in callLog[0], 'first call should have used max_tokens');
    assert.ok(!('max_completion_tokens' in callLog[0]), 'first call should not have max_completion_tokens');
    // First call should have temperature
    assert.ok('temperature' in callLog[0], 'first call should have temperature');

    // Second call switched to max_completion_tokens and dropped temperature
    assert.ok('max_completion_tokens' in callLog[1], 'second call should use max_completion_tokens');
    assert.ok(!('max_tokens' in callLog[1]), 'second call should not have max_tokens');
    assert.ok(!('temperature' in callLog[1]), 'second call should not have temperature (reasoning model)');

    // Result should be correctly parsed
    assert.deepEqual(result.data, { reviewers: ['security-api'] });
  } finally {
    Module._load = originalLoad;
    // Restore the real runtime module in cache
    delete require.cache[require.resolve('../../dist/core/runtime/direct/index')];
  }
});
