const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('module');

function loadRuntimeWithMocks() {
  const originalLoad = Module._load.bind(Module);
  const calls = {
    anthropicProviderOptions: [],
    azureProviderOptions: [],
    googleProviderOptions: [],
    openAIProviderOptions: [],
    openAICompatibleOptions: [],
    generateObjectCalls: [],
    generateTextCalls: [],
  };

  const mockAnthropic = {
    createAnthropic(options = {}) {
      calls.anthropicProviderOptions.push(options);
      return modelId => ({ provider: 'anthropic', modelId, options });
    },
  };

  const mockAzure = {
    createAzure(options = {}) {
      calls.azureProviderOptions.push(options);
      return modelId => ({ provider: 'azure', modelId, options });
    },
  };

  const mockGoogle = {
    createGoogleGenerativeAI(options = {}) {
      calls.googleProviderOptions.push(options);
      return modelId => ({ provider: 'google', modelId, options });
    },
  };

  const mockOpenAI = {
    createOpenAI(options = {}) {
      calls.openAIProviderOptions.push(options);
      return modelId => ({ provider: 'openai', modelId, options });
    },
  };

  const mockOpenAICompatible = {
    createOpenAICompatible(options = {}) {
      calls.openAICompatibleOptions.push(options);
      return {
        chatModel(modelId) {
          return { provider: 'openai-compatible', modelId, options };
        },
      };
    },
  };

  const mockAI = {
    async generateObject(options) {
      calls.generateObjectCalls.push(options);
      return {
        object: { ok: true },
        usage: { inputTokens: 10, outputTokens: 20 },
      };
    },
    async generateText(options) {
      calls.generateTextCalls.push(options);
      return { text: '{"ok":true}' };
    },
  };

  Module._load = function (request, parent, isMain) {
    if (request === 'ai') return mockAI;
    if (request === '@ai-sdk/anthropic') return mockAnthropic;
    if (request === '@ai-sdk/azure') return mockAzure;
    if (request === '@ai-sdk/google') return mockGoogle;
    if (request === '@ai-sdk/openai') return mockOpenAI;
    if (request === '@ai-sdk/openai-compatible') return mockOpenAICompatible;
    return originalLoad(request, parent, isMain);
  };

  const runtimeKey = require.resolve('../../dist/core/runtime/direct/index');
  delete require.cache[runtimeKey];

  return {
    calls,
    restore() {
      Module._load = originalLoad;
      delete require.cache[runtimeKey];
    },
    runtimeModule: require('../../dist/core/runtime/direct/index'),
  };
}

test('DirectAIRuntime.run uses the native Anthropic provider when no gateway base URL is configured', async () => {
  const { z } = require('zod');
  const fixture = loadRuntimeWithMocks();

  try {
    const runtime = new fixture.runtimeModule.DirectAIRuntime();
    const result = await runtime.run(
      {
        model: 'anthropic/claude-sonnet-4-5',
        apiKey: 'sk-anthropic',
        systemPrompt: 'Return JSON.',
        userMessage: 'Say ok.',
      },
      z.object({ ok: z.boolean() }),
    );

    assert.deepEqual(result.data, { ok: true });
    assert.equal(fixture.calls.anthropicProviderOptions.length, 1);
    assert.equal(fixture.calls.openAICompatibleOptions.length, 0);
    assert.equal(fixture.calls.generateObjectCalls[0].model.provider, 'anthropic');
    assert.equal(fixture.calls.generateObjectCalls[0].model.modelId, 'claude-sonnet-4-5');
  } finally {
    fixture.restore();
  }
});

test('DirectAIRuntime.run routes explicit apiBaseUrl through the OpenAI-compatible provider and preserves the full model id', async () => {
  const { z } = require('zod');
  const fixture = loadRuntimeWithMocks();

  try {
    const runtime = new fixture.runtimeModule.DirectAIRuntime();
    const result = await runtime.run(
      {
        model: 'anthropic/claude-sonnet-4-5',
        apiKey: 'gateway-key',
        apiBaseUrl: 'https://litellm.example.com/v1',
        systemPrompt: 'Return JSON.',
        userMessage: 'Say ok.',
      },
      z.object({ ok: z.boolean() }),
    );

    assert.deepEqual(result.data, { ok: true });
    assert.equal(fixture.calls.anthropicProviderOptions.length, 0);
    assert.equal(fixture.calls.openAICompatibleOptions.length, 1);
    assert.equal(fixture.calls.openAICompatibleOptions[0].baseURL, 'https://litellm.example.com/v1');
    assert.equal(fixture.calls.openAICompatibleOptions[0].name, 'anthropic');
    assert.equal(fixture.calls.generateObjectCalls[0].model.provider, 'openai-compatible');
    assert.equal(fixture.calls.generateObjectCalls[0].model.modelId, 'anthropic/claude-sonnet-4-5');
  } finally {
    fixture.restore();
  }
});

test('DirectAIRuntime.run uses the native OpenAI provider for OpenAI models without a custom gateway', async () => {
  const { z } = require('zod');
  const fixture = loadRuntimeWithMocks();

  try {
    const runtime = new fixture.runtimeModule.DirectAIRuntime();
    const result = await runtime.run(
      {
        model: 'openai/gpt-5.4-nano',
        apiKey: 'sk-openai',
        systemPrompt: 'Return JSON.',
        userMessage: 'Say ok.',
      },
      z.object({ ok: z.boolean() }),
    );

    assert.deepEqual(result.data, { ok: true });
    assert.equal(fixture.calls.openAIProviderOptions.length, 1);
    assert.equal(fixture.calls.openAICompatibleOptions.length, 0);
    assert.equal(fixture.calls.generateObjectCalls[0].model.provider, 'openai');
    assert.equal(fixture.calls.generateObjectCalls[0].model.modelId, 'gpt-5.4-nano');
  } finally {
    fixture.restore();
  }
});

test('DirectAIRuntime.run resolves Vercel AI Gateway credentials from .env when transport=vercel', async () => {
  const { z } = require('zod');
  const fixture = loadRuntimeWithMocks();
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-vercel-runtime-'));
  fs.writeFileSync(path.join(repoPath, '.env'), 'AI_GATEWAY_API_KEY=env-gateway-key\n');

  try {
    const runtime = new fixture.runtimeModule.DirectAIRuntime();
    const result = await runtime.run(
      {
        model: 'anthropic/claude-sonnet-4-5',
        transport: 'vercel',
        apiKey: '',
        cwd: repoPath,
        systemPrompt: 'Return JSON.',
        userMessage: 'Say ok.',
      },
      z.object({ ok: z.boolean() }),
    );

    assert.deepEqual(result.data, { ok: true });
    assert.equal(fixture.calls.openAICompatibleOptions.length, 1);
    assert.equal(fixture.calls.openAICompatibleOptions[0].apiKey, 'env-gateway-key');
    assert.equal(fixture.calls.openAICompatibleOptions[0].baseURL, 'https://ai-gateway.vercel.sh/v1');
    assert.equal(fixture.calls.generateObjectCalls[0].model.modelId, 'anthropic/claude-sonnet-4-5');
  } finally {
    fixture.restore();
  }
});

test('DirectAIRuntime.run truncates oversized input prompts before sending them to the provider', async () => {
  const { z } = require('zod');
  const fixture = loadRuntimeWithMocks();

  try {
    const runtime = new fixture.runtimeModule.DirectAIRuntime();
    await runtime.run(
      {
        model: 'openai/gpt-5.4-nano',
        apiKey: 'sk-openai',
        systemPrompt: 'S'.repeat(180),
        userMessage: 'U'.repeat(600),
        maxInputChars: 300,
      },
      z.object({ ok: z.boolean() }),
    );

    const sent = fixture.calls.generateObjectCalls[0];
    assert.ok(sent.system.length + sent.prompt.length <= 300);
    assert.match(sent.prompt, /\[\.\.\.user message truncated by BatEye\.\.\.\]/);
  } finally {
    fixture.restore();
  }
});
