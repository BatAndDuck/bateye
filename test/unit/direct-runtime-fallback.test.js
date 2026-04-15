const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// ---------------------------------------------------------------------------
// Mock harness — intercepts `ai` and provider SDK imports so we can control
// whether generateObject / generateText succeed or fail, and track calls.
// ---------------------------------------------------------------------------

function loadRuntimeWithMocks(overrides = {}) {
  const originalLoad = Module._load.bind(Module);
  const calls = {
    generateObjectCalls: [],
    generateTextCalls: [],
  };

  // Default behaviours (can be overridden per-test)
  let generateObjectImpl =
    overrides.generateObject ??
    (async () => ({ object: { ok: true }, usage: { inputTokens: 10, outputTokens: 20 } }));

  let generateTextImpl =
    overrides.generateText ??
    (async () => ({ text: '{"ok":true}', usage: { inputTokens: 10, outputTokens: 20 } }));

  const mockAI = {
    createGateway() {
      return modelId => ({ provider: 'vercel', modelId });
    },
    async generateObject(opts) {
      calls.generateObjectCalls.push(opts);
      return generateObjectImpl(opts);
    },
    async generateText(opts) {
      calls.generateTextCalls.push(opts);
      return generateTextImpl(opts);
    },
  };

  const fakeModel = (modelId) => ({ provider: 'mock', modelId });

  const mockProviders = {
    '@ai-sdk/anthropic': { createAnthropic: () => fakeModel },
    '@ai-sdk/google': { createGoogleGenerativeAI: () => fakeModel },
    '@ai-sdk/mistral': { createMistral: () => fakeModel },
    '@ai-sdk/openai': { createOpenAI: () => fakeModel },
  };

  Module._load = function (request, parent, isMain) {
    if (request === 'ai') return mockAI;
    if (mockProviders[request]) return mockProviders[request];
    return originalLoad(request, parent, isMain);
  };

  const runtimeKey = require.resolve('../../dist/core/runtime/direct/index');
  delete require.cache[runtimeKey];

  return {
    calls,
    /** Replace generateObject behaviour mid-test */
    setGenerateObject(fn) { generateObjectImpl = fn; },
    /** Replace generateText behaviour mid-test */
    setGenerateText(fn) { generateTextImpl = fn; },
    restore() {
      Module._load = originalLoad;
      delete require.cache[runtimeKey];
    },
    runtimeModule: require('../../dist/core/runtime/direct/index'),
  };
}

function baseRunOptions(extra = {}) {
  return {
    model: 'openai/gpt-5.4-nano',
    apiKey: 'sk-test',
    systemPrompt: 'Return JSON.',
    userMessage: 'Say ok.',
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Error classifier unit tests (isStructuredOutputError / isTemperatureError)
// These are private functions, but we test them indirectly through run().
// ---------------------------------------------------------------------------

test('Tier 1 succeeds: generateObject works normally without fallback', async () => {
  const { z } = require('zod');
  const fixture = loadRuntimeWithMocks();

  try {
    const runtime = new fixture.runtimeModule.DirectAIRuntime();
    const result = await runtime.run(baseRunOptions(), z.object({ ok: z.boolean() }));

    assert.deepEqual(result.data, { ok: true });
    assert.equal(result.runtime, 'sdk');
    assert.equal(fixture.calls.generateObjectCalls.length, 1);
    assert.equal(fixture.calls.generateTextCalls.length, 0);
  } finally {
    fixture.restore();
  }
});

test('Tier 3: structured output error triggers text fallback with valid JSON response', async () => {
  const { z } = require('zod');
  const fixture = loadRuntimeWithMocks({
    generateObject: async () => { throw new Error('Invalid input'); },
    generateText: async () => ({ text: '{"ok":true}', usage: { inputTokens: 5, outputTokens: 5 } }),
  });

  try {
    const runtime = new fixture.runtimeModule.DirectAIRuntime();
    const result = await runtime.run(baseRunOptions(), z.object({ ok: z.boolean() }));

    assert.deepEqual(result.data, { ok: true });
    // generateObject was called once (Tier 1), then exactly one generateText for fallback
    // (JSON is valid so no repair call is needed)
    assert.equal(fixture.calls.generateObjectCalls.length, 1);
    assert.equal(fixture.calls.generateTextCalls.length, 1);
    assert.equal(fixture.calls.generateTextCalls[0].system, 'Return JSON.');
    assert.equal(fixture.calls.generateTextCalls[0].prompt, 'Say ok.');
  } finally {
    fixture.restore();
  }
});

test('Tier 3: structured output error "does not support object generation" triggers fallback', async () => {
  const { z } = require('zod');
  const fixture = loadRuntimeWithMocks({
    generateObject: async () => { throw new Error('This model does not support object generation'); },
    generateText: async () => ({ text: '{"ok":true}', usage: { inputTokens: 5, outputTokens: 5 } }),
  });

  try {
    const runtime = new fixture.runtimeModule.DirectAIRuntime();
    const result = await runtime.run(baseRunOptions(), z.object({ ok: z.boolean() }));

    assert.deepEqual(result.data, { ok: true });
    assert.equal(fixture.calls.generateObjectCalls.length, 1);
    assert.equal(fixture.calls.generateTextCalls.length, 1);
  } finally {
    fixture.restore();
  }
});

test('Tier 3: "response_format is not supported" triggers fallback', async () => {
  const { z } = require('zod');
  const fixture = loadRuntimeWithMocks({
    generateObject: async () => { throw new Error('response_format is not supported for this model'); },
    generateText: async () => ({ text: '{"ok":true}', usage: { inputTokens: 5, outputTokens: 5 } }),
  });

  try {
    const runtime = new fixture.runtimeModule.DirectAIRuntime();
    const result = await runtime.run(baseRunOptions(), z.object({ ok: z.boolean() }));

    assert.deepEqual(result.data, { ok: true });
    assert.equal(fixture.calls.generateObjectCalls.length, 1);
    assert.equal(fixture.calls.generateTextCalls.length, 1);
  } finally {
    fixture.restore();
  }
});

test('Tier 3: "Unsupported parameter: response_format" triggers fallback', async () => {
  const { z } = require('zod');
  const fixture = loadRuntimeWithMocks({
    generateObject: async () => { throw new Error('Unsupported parameter: response_format'); },
    generateText: async () => ({ text: '{"ok":true}', usage: { inputTokens: 5, outputTokens: 5 } }),
  });

  try {
    const runtime = new fixture.runtimeModule.DirectAIRuntime();
    const result = await runtime.run(baseRunOptions(), z.object({ ok: z.boolean() }));

    assert.deepEqual(result.data, { ok: true });
    assert.equal(fixture.calls.generateObjectCalls.length, 1);
    assert.equal(fixture.calls.generateTextCalls.length, 1);
  } finally {
    fixture.restore();
  }
});

test('Tier 3: "json_schema is not available" triggers fallback', async () => {
  const { z } = require('zod');
  const fixture = loadRuntimeWithMocks({
    generateObject: async () => { throw new Error('json_schema is not available for this model'); },
    generateText: async () => ({ text: '{"ok":true}', usage: { inputTokens: 5, outputTokens: 5 } }),
  });

  try {
    const runtime = new fixture.runtimeModule.DirectAIRuntime();
    const result = await runtime.run(baseRunOptions(), z.object({ ok: z.boolean() }));

    assert.deepEqual(result.data, { ok: true });
    assert.equal(fixture.calls.generateObjectCalls.length, 1);
    assert.equal(fixture.calls.generateTextCalls.length, 1);
  } finally {
    fixture.restore();
  }
});

test('Tier 3: "tool_choice is not supported" triggers fallback', async () => {
  const { z } = require('zod');
  const fixture = loadRuntimeWithMocks({
    generateObject: async () => { throw new Error('tool_choice is not supported by this model'); },
    generateText: async () => ({ text: '{"ok":true}', usage: { inputTokens: 5, outputTokens: 5 } }),
  });

  try {
    const runtime = new fixture.runtimeModule.DirectAIRuntime();
    const result = await runtime.run(baseRunOptions(), z.object({ ok: z.boolean() }));

    assert.deepEqual(result.data, { ok: true });
    assert.equal(fixture.calls.generateObjectCalls.length, 1);
    assert.equal(fixture.calls.generateTextCalls.length, 1);
  } finally {
    fixture.restore();
  }
});

test('Tier 3: "model does not support json" triggers fallback', async () => {
  const { z } = require('zod');
  const fixture = loadRuntimeWithMocks({
    generateObject: async () => { throw new Error('This model does not support json mode'); },
    generateText: async () => ({ text: '{"ok":true}', usage: { inputTokens: 5, outputTokens: 5 } }),
  });

  try {
    const runtime = new fixture.runtimeModule.DirectAIRuntime();
    const result = await runtime.run(baseRunOptions(), z.object({ ok: z.boolean() }));

    assert.deepEqual(result.data, { ok: true });
    assert.equal(fixture.calls.generateObjectCalls.length, 1);
    assert.equal(fixture.calls.generateTextCalls.length, 1);
  } finally {
    fixture.restore();
  }
});

test('Tier 2: temperature error retries generateObject without temperature', async () => {
  const { z } = require('zod');
  let callCount = 0;
  const fixture = loadRuntimeWithMocks({
    generateObject: async (opts) => {
      callCount++;
      if (callCount === 1) {
        throw new Error('temperature is not supported for this model');
      }
      // Second call should not have temperature
      return { object: { ok: true }, usage: { inputTokens: 10, outputTokens: 20 } };
    },
    generateText: async () => ({ text: '{"ok":true}', usage: { inputTokens: 5, outputTokens: 5 } }),
  });

  try {
    const runtime = new fixture.runtimeModule.DirectAIRuntime();
    const result = await runtime.run(
      baseRunOptions({ temperature: 0 }),
      z.object({ ok: z.boolean() }),
    );

    assert.deepEqual(result.data, { ok: true });
    // Two generateObject calls: first with temperature, second without
    assert.equal(fixture.calls.generateObjectCalls.length, 2);
    assert.equal(fixture.calls.generateObjectCalls[0].temperature, 0);
    assert.equal(fixture.calls.generateObjectCalls[1].temperature, undefined);
    // No generateText fallback needed
    assert.equal(fixture.calls.generateTextCalls.length, 0);
  } finally {
    fixture.restore();
  }
});

test('Tier 2: "Unsupported parameter: temperature" triggers temperature retry', async () => {
  const { z } = require('zod');
  let callCount = 0;
  const fixture = loadRuntimeWithMocks({
    generateObject: async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error('Unsupported parameter: temperature');
      }
      return { object: { ok: true }, usage: { inputTokens: 10, outputTokens: 20 } };
    },
  });

  try {
    const runtime = new fixture.runtimeModule.DirectAIRuntime();
    const result = await runtime.run(
      baseRunOptions({ temperature: 0 }),
      z.object({ ok: z.boolean() }),
    );

    assert.deepEqual(result.data, { ok: true });
    assert.equal(fixture.calls.generateObjectCalls.length, 2);
    assert.equal(fixture.calls.generateObjectCalls[0].temperature, 0);
    assert.equal(fixture.calls.generateObjectCalls[1].temperature, undefined);
    assert.equal(fixture.calls.generateTextCalls.length, 0);
  } finally {
    fixture.restore();
  }
});

test('Tier 2: "temperature must be 1" triggers temperature retry', async () => {
  const { z } = require('zod');
  let callCount = 0;
  const fixture = loadRuntimeWithMocks({
    generateObject: async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error('temperature must be 1 for this model');
      }
      return { object: { ok: true }, usage: { inputTokens: 10, outputTokens: 20 } };
    },
  });

  try {
    const runtime = new fixture.runtimeModule.DirectAIRuntime();
    const result = await runtime.run(
      baseRunOptions({ temperature: 0 }),
      z.object({ ok: z.boolean() }),
    );

    assert.deepEqual(result.data, { ok: true });
    assert.equal(fixture.calls.generateObjectCalls.length, 2);
    assert.equal(fixture.calls.generateObjectCalls[0].temperature, 0);
    assert.equal(fixture.calls.generateObjectCalls[1].temperature, undefined);
    assert.equal(fixture.calls.generateTextCalls.length, 0);
  } finally {
    fixture.restore();
  }
});

test('Tier 2→3: temperature error then structured output error falls through to text', async () => {
  const { z } = require('zod');
  let callCount = 0;
  const fixture = loadRuntimeWithMocks({
    generateObject: async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error('temperature is not supported for this model');
      }
      // Second attempt (without temperature) also fails with structured output error
      throw new Error('Invalid input');
    },
    generateText: async () => ({ text: '{"ok":true}', usage: { inputTokens: 5, outputTokens: 5 } }),
  });

  try {
    const runtime = new fixture.runtimeModule.DirectAIRuntime();
    const result = await runtime.run(
      baseRunOptions({ temperature: 0 }),
      z.object({ ok: z.boolean() }),
    );

    assert.deepEqual(result.data, { ok: true });
    // Two generateObject attempts (Tier 1 + Tier 2), then exactly one text fallback (Tier 3)
    assert.equal(fixture.calls.generateObjectCalls.length, 2);
    assert.equal(fixture.calls.generateTextCalls.length, 1);
  } finally {
    fixture.restore();
  }
});

test('temperature error without temperature option set does NOT trigger Tier 2 retry', async () => {
  const { z } = require('zod');
  const fixture = loadRuntimeWithMocks({
    generateObject: async () => { throw new Error('temperature is not supported'); },
  });

  try {
    const runtime = new fixture.runtimeModule.DirectAIRuntime();
    // No temperature option set — Tier 2 should not apply, error propagates
    await assert.rejects(
      () => runtime.run(baseRunOptions(), z.object({ ok: z.boolean() })),
      /temperature is not supported/,
    );
    assert.equal(fixture.calls.generateObjectCalls.length, 1);
  } finally {
    fixture.restore();
  }
});

test('non-matching error propagates without fallback', async () => {
  const { z } = require('zod');
  const fixture = loadRuntimeWithMocks({
    generateObject: async () => { throw new Error('authentication failed: invalid API key'); },
  });

  try {
    const runtime = new fixture.runtimeModule.DirectAIRuntime();
    await assert.rejects(
      () => runtime.run(baseRunOptions(), z.object({ ok: z.boolean() })),
      /authentication failed/,
    );
    // Only one call — no retry, no fallback
    assert.equal(fixture.calls.generateObjectCalls.length, 1);
    assert.equal(fixture.calls.generateTextCalls.length, 0);
  } finally {
    fixture.restore();
  }
});

test('rate limit error propagates without fallback', async () => {
  const { z } = require('zod');
  const fixture = loadRuntimeWithMocks({
    generateObject: async () => { throw new Error('429 Too Many Requests'); },
  });

  try {
    const runtime = new fixture.runtimeModule.DirectAIRuntime();
    await assert.rejects(
      () => runtime.run(baseRunOptions(), z.object({ ok: z.boolean() })),
      /429 Too Many Requests/,
    );
    assert.equal(fixture.calls.generateObjectCalls.length, 1);
    assert.equal(fixture.calls.generateTextCalls.length, 0);
  } finally {
    fixture.restore();
  }
});

test('long "Invalid input" error message does NOT trigger structured output fallback', async () => {
  const { z } = require('zod');
  // A long error message containing "Invalid input" should not be treated as a
  // structured output error (to avoid false positives on detailed validation errors).
  const longMsg = 'Invalid input: ' + 'x'.repeat(300);
  const fixture = loadRuntimeWithMocks({
    generateObject: async () => { throw new Error(longMsg); },
  });

  try {
    const runtime = new fixture.runtimeModule.DirectAIRuntime();
    await assert.rejects(
      () => runtime.run(baseRunOptions(), z.object({ ok: z.boolean() })),
      /Invalid input/,
    );
    assert.equal(fixture.calls.generateObjectCalls.length, 1);
    assert.equal(fixture.calls.generateTextCalls.length, 0);
  } finally {
    fixture.restore();
  }
});

test('text fallback extracts JSON from markdown fenced response', async () => {
  const { z } = require('zod');
  const fixture = loadRuntimeWithMocks({
    generateObject: async () => { throw new Error('Invalid input'); },
    generateText: async () => ({
      text: 'Here is the result:\n```json\n{"ok":true}\n```\n',
      usage: { inputTokens: 5, outputTokens: 5 },
    }),
  });

  try {
    const runtime = new fixture.runtimeModule.DirectAIRuntime();
    const result = await runtime.run(baseRunOptions(), z.object({ ok: z.boolean() }));

    assert.deepEqual(result.data, { ok: true });
  } finally {
    fixture.restore();
  }
});

test('text fallback extracts JSON embedded in surrounding text', async () => {
  const { z } = require('zod');
  const fixture = loadRuntimeWithMocks({
    generateObject: async () => { throw new Error('Invalid input'); },
    generateText: async () => ({
      text: 'I analyzed the code and here is my response: {"ok":true} Hope this helps!',
      usage: { inputTokens: 5, outputTokens: 5 },
    }),
  });

  try {
    const runtime = new fixture.runtimeModule.DirectAIRuntime();
    const result = await runtime.run(baseRunOptions(), z.object({ ok: z.boolean() }));

    assert.deepEqual(result.data, { ok: true });
  } finally {
    fixture.restore();
  }
});

test('text fallback attempts repair when initial JSON is invalid', async () => {
  const { z } = require('zod');
  let textCallCount = 0;
  const fixture = loadRuntimeWithMocks({
    generateObject: async () => { throw new Error('Invalid input'); },
    generateText: async () => {
      textCallCount++;
      if (textCallCount === 1) {
        // First call: fallback text response with invalid JSON (missing required field)
        return { text: '{"wrong_field":true}', usage: { inputTokens: 5, outputTokens: 5 } };
      }
      // Second call: repair attempt returns valid JSON
      return { text: '{"ok":true}', usage: { inputTokens: 5, outputTokens: 5 } };
    },
  });

  try {
    const runtime = new fixture.runtimeModule.DirectAIRuntime();
    const result = await runtime.run(baseRunOptions(), z.object({ ok: z.boolean() }));

    assert.deepEqual(result.data, { ok: true });
    // Exactly 2 generateText calls: one for the fallback (invalid JSON), one for repair
    assert.equal(fixture.calls.generateTextCalls.length, 2);
  } finally {
    fixture.restore();
  }
});

test('text fallback throws when both extraction and repair fail', async () => {
  const { z } = require('zod');
  const fixture = loadRuntimeWithMocks({
    generateObject: async () => { throw new Error('Invalid input'); },
    generateText: async () => ({
      text: 'I cannot produce valid JSON for this request.',
      usage: { inputTokens: 5, outputTokens: 5 },
    }),
  });

  try {
    const runtime = new fixture.runtimeModule.DirectAIRuntime();
    await assert.rejects(
      () => runtime.run(baseRunOptions(), z.object({ ok: z.boolean() })),
    );
  } finally {
    fixture.restore();
  }
});

test('text fallback omits temperature when omitTemperature is triggered', async () => {
  const { z } = require('zod');
  let objCallCount = 0;
  const fixture = loadRuntimeWithMocks({
    generateObject: async () => {
      objCallCount++;
      if (objCallCount === 1) {
        throw new Error('temperature is not supported for this model');
      }
      // Tier 2 retry also fails with structured output error
      throw new Error('Invalid input');
    },
    generateText: async () => ({
      text: '{"ok":true}',
      usage: { inputTokens: 5, outputTokens: 5 },
    }),
  });

  try {
    const runtime = new fixture.runtimeModule.DirectAIRuntime();
    const result = await runtime.run(
      baseRunOptions({ temperature: 0 }),
      z.object({ ok: z.boolean() }),
    );

    assert.deepEqual(result.data, { ok: true });
    // The text fallback call should NOT have temperature set
    const textCall = fixture.calls.generateTextCalls[0];
    assert.equal(textCall.temperature, undefined);
  } finally {
    fixture.restore();
  }
});

test('text fallback preserves temperature when temperature was not the error', async () => {
  const { z } = require('zod');
  const fixture = loadRuntimeWithMocks({
    generateObject: async () => { throw new Error('Invalid input'); },
    generateText: async () => ({
      text: '{"ok":true}',
      usage: { inputTokens: 5, outputTokens: 5 },
    }),
  });

  try {
    const runtime = new fixture.runtimeModule.DirectAIRuntime();
    const result = await runtime.run(
      baseRunOptions({ temperature: 0.5 }),
      z.object({ ok: z.boolean() }),
    );

    assert.deepEqual(result.data, { ok: true });
    // Temperature should be preserved in the text fallback since it wasn't the problem
    const textCall = fixture.calls.generateTextCalls[0];
    assert.equal(textCall.temperature, 0.5);
  } finally {
    fixture.restore();
  }
});

test('text fallback passes system prompt and user message correctly', async () => {
  const { z } = require('zod');
  const fixture = loadRuntimeWithMocks({
    generateObject: async () => { throw new Error('Invalid input'); },
    generateText: async () => ({
      text: '{"ok":true}',
      usage: { inputTokens: 5, outputTokens: 5 },
    }),
  });

  try {
    const runtime = new fixture.runtimeModule.DirectAIRuntime();
    await runtime.run(
      baseRunOptions({ systemPrompt: 'Be a JSON bot.', userMessage: 'Produce output.' }),
      z.object({ ok: z.boolean() }),
    );

    const textCall = fixture.calls.generateTextCalls[0];
    assert.equal(textCall.system, 'Be a JSON bot.');
    assert.equal(textCall.prompt, 'Produce output.');
  } finally {
    fixture.restore();
  }
});

test('Tier 2→3 propagates non-structured-output error from Tier 2', async () => {
  const { z } = require('zod');
  let callCount = 0;
  const fixture = loadRuntimeWithMocks({
    generateObject: async () => {
      callCount++;
      if (callCount === 1) throw new Error('temperature is not supported');
      throw new Error('network timeout');
    },
  });

  try {
    const runtime = new fixture.runtimeModule.DirectAIRuntime();
    await assert.rejects(
      () => runtime.run(baseRunOptions({ temperature: 0 }), z.object({ ok: z.boolean() })),
      /network timeout/,
    );
    assert.equal(fixture.calls.generateObjectCalls.length, 2);
    assert.equal(fixture.calls.generateTextCalls.length, 0);
  } finally {
    fixture.restore();
  }
});

test('text fallback works with complex schema', async () => {
  const { z } = require('zod');
  const complexSchema = z.object({
    intentSummary: z.string(),
    selectedReviewers: z.array(z.object({
      reviewerId: z.string(),
      confidence: z.number(),
    })),
  });

  const fixture = loadRuntimeWithMocks({
    generateObject: async () => { throw new Error('Invalid input'); },
    generateText: async () => ({
      text: JSON.stringify({
        intentSummary: 'Add multiply helper',
        selectedReviewers: [{ reviewerId: 'code-quality', confidence: 0.9 }],
      }),
      usage: { inputTokens: 10, outputTokens: 30 },
    }),
  });

  try {
    const runtime = new fixture.runtimeModule.DirectAIRuntime();
    const result = await runtime.run(baseRunOptions(), complexSchema);

    assert.equal(result.data.intentSummary, 'Add multiply helper');
    assert.equal(result.data.selectedReviewers.length, 1);
    assert.equal(result.data.selectedReviewers[0].reviewerId, 'code-quality');
    assert.equal(result.data.selectedReviewers[0].confidence, 0.9);
  } finally {
    fixture.restore();
  }
});

test('nested cause error is detected as structured output error', async () => {
  const { z } = require('zod');
  const nestedError = new Error('API call failed');
  nestedError.cause = new Error('Invalid input');

  const fixture = loadRuntimeWithMocks({
    generateObject: async () => { throw nestedError; },
    generateText: async () => ({
      text: '{"ok":true}',
      usage: { inputTokens: 5, outputTokens: 5 },
    }),
  });

  try {
    const runtime = new fixture.runtimeModule.DirectAIRuntime();
    const result = await runtime.run(baseRunOptions(), z.object({ ok: z.boolean() }));

    assert.deepEqual(result.data, { ok: true });
    assert.equal(fixture.calls.generateObjectCalls.length, 1);
    assert.equal(fixture.calls.generateTextCalls.length, 1);
  } finally {
    fixture.restore();
  }
});

test('nested cause error is detected as temperature error', async () => {
  const { z } = require('zod');
  const nestedError = new Error('Provider error');
  nestedError.cause = new Error('invalid temperature value');
  let callCount = 0;

  const fixture = loadRuntimeWithMocks({
    generateObject: async () => {
      callCount++;
      if (callCount === 1) throw nestedError;
      return { object: { ok: true }, usage: { inputTokens: 10, outputTokens: 20 } };
    },
  });

  try {
    const runtime = new fixture.runtimeModule.DirectAIRuntime();
    const result = await runtime.run(
      baseRunOptions({ temperature: 0 }),
      z.object({ ok: z.boolean() }),
    );

    assert.deepEqual(result.data, { ok: true });
    assert.equal(fixture.calls.generateObjectCalls.length, 2);
  } finally {
    fixture.restore();
  }
});

test('result metadata is correct when text fallback is used', async () => {
  const { z } = require('zod');
  const fixture = loadRuntimeWithMocks({
    generateObject: async () => { throw new Error('Invalid input'); },
    generateText: async () => ({
      text: '{"ok":true}',
      usage: { inputTokens: 15, outputTokens: 25 },
    }),
  });

  try {
    const runtime = new fixture.runtimeModule.DirectAIRuntime();
    const result = await runtime.run(
      baseRunOptions({ model: 'vercel/openai/gpt-5.4-nano' }),
      z.object({ ok: z.boolean() }),
    );

    assert.equal(result.model, 'vercel/openai/gpt-5.4-nano');
    assert.equal(result.runtime, 'sdk');
    assert.equal(typeof result.durationMs, 'number');
    assert.ok(result.durationMs >= 0);
    assert.equal(typeof result.rawResponse, 'string');
    assert.ok(result.tokensUsed);
  } finally {
    fixture.restore();
  }
});

// ---------------------------------------------------------------------------
// Structure repair temperature resilience
// ---------------------------------------------------------------------------

test('repair text function retries without temperature on temperature error', async () => {
  // This test exercises buildRepairTextFunction by making the mock generateObject
  // call opts.experimental_repairText (simulating the Vercel AI SDK's repair flow).
  // The first generateText (with temperature: 0) throws; the retry without
  // temperature succeeds, and the repaired JSON is returned as the final object.
  const { z } = require('zod');
  const textCalls = [];

  const fixture = loadRuntimeWithMocks({
    generateObject: async (opts) => {
      // Simulate SDK: model returned malformed JSON, SDK calls experimental_repairText
      if (opts.experimental_repairText) {
        const repaired = await opts.experimental_repairText({
          text: '{"broken":',
          error: new Error('JSON parse error'),
        });
        if (repaired) {
          return { object: JSON.parse(repaired), usage: { inputTokens: 10, outputTokens: 20 } };
        }
      }
      throw new Error('repair returned null');
    },
    generateText: async (opts) => {
      textCalls.push({ temperature: opts.temperature });
      if (textCalls.length === 1) {
        // First repair attempt (with temperature: 0) throws
        throw new Error('temperature is not supported');
      }
      // Second attempt (without temperature) succeeds
      return { text: '{"ok":true}', usage: { inputTokens: 5, outputTokens: 5 } };
    },
  });

  try {
    const runtime = new fixture.runtimeModule.DirectAIRuntime();
    const result = await runtime.run(baseRunOptions(), z.object({ ok: z.boolean() }));

    assert.deepEqual(result.data, { ok: true });
    // Two generateText calls: first with temperature: 0, second without
    assert.equal(textCalls.length, 2);
    assert.equal(textCalls[0].temperature, 0);
    assert.equal(textCalls[1].temperature, undefined);
  } finally {
    fixture.restore();
  }
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

test('text fallback handles empty text response gracefully', async () => {
  const { z } = require('zod');
  const fixture = loadRuntimeWithMocks({
    generateObject: async () => { throw new Error('Invalid input'); },
    generateText: async () => ({
      text: '',
      usage: { inputTokens: 5, outputTokens: 0 },
    }),
  });

  try {
    const runtime = new fixture.runtimeModule.DirectAIRuntime();
    await assert.rejects(
      () => runtime.run(baseRunOptions(), z.object({ ok: z.boolean() })),
    );
  } finally {
    fixture.restore();
  }
});

test('text fallback handles thinking model prefix in response', async () => {
  const { z } = require('zod');
  const fixture = loadRuntimeWithMocks({
    generateObject: async () => { throw new Error('Invalid input'); },
    generateText: async () => ({
      text: '<think>Let me analyze this code...</think>\n\n{"ok":true}',
      usage: { inputTokens: 5, outputTokens: 15 },
    }),
  });

  try {
    const runtime = new fixture.runtimeModule.DirectAIRuntime();
    const result = await runtime.run(baseRunOptions(), z.object({ ok: z.boolean() }));

    assert.deepEqual(result.data, { ok: true });
  } finally {
    fixture.restore();
  }
});

test('text fallback with generateText failure propagates error', async () => {
  const { z } = require('zod');
  const fixture = loadRuntimeWithMocks({
    generateObject: async () => { throw new Error('Invalid input'); },
    generateText: async () => { throw new Error('API quota exceeded'); },
  });

  try {
    const runtime = new fixture.runtimeModule.DirectAIRuntime();
    await assert.rejects(
      () => runtime.run(baseRunOptions(), z.object({ ok: z.boolean() })),
      /API quota exceeded/,
    );
  } finally {
    fixture.restore();
  }
});

// ---------------------------------------------------------------------------
// Schema constraint errors (Anthropic, Gemini and similar providers that
// support structured output but reject specific JSON schema keywords)
// ---------------------------------------------------------------------------

test('Anthropic schema constraint error triggers fallback (minimum/maximum on number)', async () => {
  const { z } = require('zod');
  // Exact error from Anthropic API when schema has .min()/.max() on number fields
  const fixture = loadRuntimeWithMocks({
    generateObject: async () => {
      throw new Error(
        "output_config.format.schema: For 'number' type, properties maximum, minimum are not supported",
      );
    },
    generateText: async () => ({ text: '{"ok":true}', usage: { inputTokens: 5, outputTokens: 5 } }),
  });

  try {
    const runtime = new fixture.runtimeModule.DirectAIRuntime();
    const result = await runtime.run(baseRunOptions(), z.object({ ok: z.boolean() }));

    assert.deepEqual(result.data, { ok: true });
    assert.equal(fixture.calls.generateObjectCalls.length, 1);
    assert.equal(fixture.calls.generateTextCalls.length, 1);
  } finally {
    fixture.restore();
  }
});

test('output_config.format.schema prefix alone triggers fallback', async () => {
  const { z } = require('zod');
  const fixture = loadRuntimeWithMocks({
    generateObject: async () => {
      throw new Error('output_config.format.schema: property X is invalid');
    },
    generateText: async () => ({ text: '{"ok":true}', usage: { inputTokens: 5, outputTokens: 5 } }),
  });

  try {
    const runtime = new fixture.runtimeModule.DirectAIRuntime();
    const result = await runtime.run(baseRunOptions(), z.object({ ok: z.boolean() }));

    assert.deepEqual(result.data, { ok: true });
  } finally {
    fixture.restore();
  }
});

test('schema constraint: "minimum not supported" triggers fallback', async () => {
  const { z } = require('zod');
  const fixture = loadRuntimeWithMocks({
    generateObject: async () => {
      throw new Error("Schema validation failed: 'minimum' is not supported for this model");
    },
    generateText: async () => ({ text: '{"ok":true}', usage: { inputTokens: 5, outputTokens: 5 } }),
  });

  try {
    const runtime = new fixture.runtimeModule.DirectAIRuntime();
    const result = await runtime.run(baseRunOptions(), z.object({ ok: z.boolean() }));

    assert.deepEqual(result.data, { ok: true });
  } finally {
    fixture.restore();
  }
});

test('schema constraint: "maximum not supported" triggers fallback', async () => {
  const { z } = require('zod');
  const fixture = loadRuntimeWithMocks({
    generateObject: async () => {
      throw new Error("JSON schema error: maximum is not supported");
    },
    generateText: async () => ({ text: '{"ok":true}', usage: { inputTokens: 5, outputTokens: 5 } }),
  });

  try {
    const runtime = new fixture.runtimeModule.DirectAIRuntime();
    const result = await runtime.run(baseRunOptions(), z.object({ ok: z.boolean() }));

    assert.deepEqual(result.data, { ok: true });
  } finally {
    fixture.restore();
  }
});

test('schema constraint: "minItems not supported" triggers fallback (array constraints)', async () => {
  const { z } = require('zod');
  const fixture = loadRuntimeWithMocks({
    generateObject: async () => {
      throw new Error("properties minItems, maxItems are not supported");
    },
    generateText: async () => ({ text: '{"ok":true}', usage: { inputTokens: 5, outputTokens: 5 } }),
  });

  try {
    const runtime = new fixture.runtimeModule.DirectAIRuntime();
    const result = await runtime.run(baseRunOptions(), z.object({ ok: z.boolean() }));

    assert.deepEqual(result.data, { ok: true });
  } finally {
    fixture.restore();
  }
});

test('schema constraint: "minLength not supported" triggers fallback (string constraints)', async () => {
  const { z } = require('zod');
  const fixture = loadRuntimeWithMocks({
    generateObject: async () => {
      throw new Error("For 'string' type, properties minLength, maxLength are not supported");
    },
    generateText: async () => ({ text: '{"ok":true}', usage: { inputTokens: 5, outputTokens: 5 } }),
  });

  try {
    const runtime = new fixture.runtimeModule.DirectAIRuntime();
    const result = await runtime.run(baseRunOptions(), z.object({ ok: z.boolean() }));

    assert.deepEqual(result.data, { ok: true });
  } finally {
    fixture.restore();
  }
});

test('schema constraint: "not supported" before keyword also triggers fallback', async () => {
  const { z } = require('zod');
  const fixture = loadRuntimeWithMocks({
    generateObject: async () => {
      throw new Error("Feature not supported: minimum constraint validation");
    },
    generateText: async () => ({ text: '{"ok":true}', usage: { inputTokens: 5, outputTokens: 5 } }),
  });

  try {
    const runtime = new fixture.runtimeModule.DirectAIRuntime();
    const result = await runtime.run(baseRunOptions(), z.object({ ok: z.boolean() }));

    assert.deepEqual(result.data, { ok: true });
  } finally {
    fixture.restore();
  }
});

test('schema constraint error with schema having number min/max fields still validates correctly after fallback', async () => {
  const { z } = require('zod');
  // This simulates the real orchestratorResultSchema with confidence: z.number().min(0).max(1)
  const orchestratorLikeSchema = z.object({
    intentSummary: z.string(),
    selectedReviewers: z.array(z.object({
      reviewerId: z.string(),
      reason: z.string(),
      confidence: z.number().min(0).max(1),
    })),
  });

  const fixture = loadRuntimeWithMocks({
    generateObject: async () => {
      throw new Error(
        "output_config.format.schema: For 'number' type, properties maximum, minimum are not supported",
      );
    },
    generateText: async () => ({
      text: JSON.stringify({
        intentSummary: 'Add multiply function',
        selectedReviewers: [{ reviewerId: 'integration-smoke', reason: 'source change', confidence: 0.95 }],
      }),
      usage: { inputTokens: 10, outputTokens: 30 },
    }),
  });

  try {
    const runtime = new fixture.runtimeModule.DirectAIRuntime();
    const result = await runtime.run(baseRunOptions(), orchestratorLikeSchema);

    // Zod validation on the client side still enforces min/max (0.95 is within [0,1])
    assert.equal(result.data.selectedReviewers[0].confidence, 0.95);
    assert.equal(result.data.selectedReviewers[0].reviewerId, 'integration-smoke');
  } finally {
    fixture.restore();
  }
});

test('schema constraint error in nested cause chain triggers fallback', async () => {
  const { z } = require('zod');
  const outerErr = new Error('Provider API error');
  outerErr.cause = new Error(
    "output_config.format.schema: For 'number' type, properties maximum, minimum are not supported",
  );

  const fixture = loadRuntimeWithMocks({
    generateObject: async () => { throw outerErr; },
    generateText: async () => ({ text: '{"ok":true}', usage: { inputTokens: 5, outputTokens: 5 } }),
  });

  try {
    const runtime = new fixture.runtimeModule.DirectAIRuntime();
    const result = await runtime.run(baseRunOptions(), z.object({ ok: z.boolean() }));

    assert.deepEqual(result.data, { ok: true });
  } finally {
    fixture.restore();
  }
});

// ---------------------------------------------------------------------------
// AI SDK structured output failures (NoObjectGeneratedError, JSONParseError,
// TypeValidationError) — thrown when generateObject repair also fails.
// These should trigger the same text fallback as a provider rejection.
// ---------------------------------------------------------------------------

test('AI_NoObjectGeneratedError triggers text fallback', async () => {
  const { z } = require('zod');
  const sdkErr = new Error('No object generated.');
  sdkErr.name = 'AI_NoObjectGeneratedError';

  const fixture = loadRuntimeWithMocks({
    generateObject: async () => { throw sdkErr; },
    generateText: async () => ({ text: '{"ok":true}', usage: { inputTokens: 5, outputTokens: 5 } }),
  });

  try {
    const runtime = new fixture.runtimeModule.DirectAIRuntime();
    const result = await runtime.run(baseRunOptions(), z.object({ ok: z.boolean() }));

    assert.deepEqual(result.data, { ok: true });
    assert.equal(fixture.calls.generateObjectCalls.length, 1);
    assert.equal(fixture.calls.generateTextCalls.length, 1);
  } finally {
    fixture.restore();
  }
});

test('AI_NoContentGeneratedError triggers text fallback', async () => {
  const { z } = require('zod');
  const sdkErr = new Error('No content generated.');
  sdkErr.name = 'AI_NoContentGeneratedError';

  const fixture = loadRuntimeWithMocks({
    generateObject: async () => { throw sdkErr; },
    generateText: async () => ({ text: '{"ok":true}', usage: { inputTokens: 5, outputTokens: 5 } }),
  });

  try {
    const runtime = new fixture.runtimeModule.DirectAIRuntime();
    const result = await runtime.run(baseRunOptions(), z.object({ ok: z.boolean() }));

    assert.deepEqual(result.data, { ok: true });
    assert.equal(fixture.calls.generateObjectCalls.length, 1);
    assert.equal(fixture.calls.generateTextCalls.length, 1);
  } finally {
    fixture.restore();
  }
});

test('AI_JSONParseError triggers text fallback', async () => {
  const { z } = require('zod');
  const sdkErr = new Error('JSON parsing failed: Text: invalid json. Error message: Unexpected token');
  sdkErr.name = 'AI_JSONParseError';

  const fixture = loadRuntimeWithMocks({
    generateObject: async () => { throw sdkErr; },
    generateText: async () => ({ text: '{"ok":true}', usage: { inputTokens: 5, outputTokens: 5 } }),
  });

  try {
    const runtime = new fixture.runtimeModule.DirectAIRuntime();
    const result = await runtime.run(baseRunOptions(), z.object({ ok: z.boolean() }));

    assert.deepEqual(result.data, { ok: true });
    assert.equal(fixture.calls.generateObjectCalls.length, 1);
    assert.equal(fixture.calls.generateTextCalls.length, 1);
  } finally {
    fixture.restore();
  }
});

test('AI_TypeValidationError triggers text fallback', async () => {
  const { z } = require('zod');
  const sdkErr = new Error('Type validation failed: Value: {"score":2}. Error message: score must be <= 1');
  sdkErr.name = 'AI_TypeValidationError';

  const fixture = loadRuntimeWithMocks({
    generateObject: async () => { throw sdkErr; },
    generateText: async () => ({ text: '{"ok":true}', usage: { inputTokens: 5, outputTokens: 5 } }),
  });

  try {
    const runtime = new fixture.runtimeModule.DirectAIRuntime();
    const result = await runtime.run(baseRunOptions(), z.object({ ok: z.boolean() }));

    assert.deepEqual(result.data, { ok: true });
    assert.equal(fixture.calls.generateObjectCalls.length, 1);
    assert.equal(fixture.calls.generateTextCalls.length, 1);
  } finally {
    fixture.restore();
  }
});

test('AI_NoObjectGeneratedError in nested cause chain triggers text fallback', async () => {
  const { z } = require('zod');
  const outerErr = new Error('generateObject failed after repair');
  outerErr.cause = Object.assign(new Error('No object generated.'), { name: 'AI_NoObjectGeneratedError' });

  const fixture = loadRuntimeWithMocks({
    generateObject: async () => { throw outerErr; },
    generateText: async () => ({ text: '{"ok":true}', usage: { inputTokens: 5, outputTokens: 5 } }),
  });

  try {
    const runtime = new fixture.runtimeModule.DirectAIRuntime();
    const result = await runtime.run(baseRunOptions(), z.object({ ok: z.boolean() }));

    assert.deepEqual(result.data, { ok: true });
  } finally {
    fixture.restore();
  }
});
