const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { z } = require('zod');

function loadWithMocks(modulePath, mocks) {
  const originalLoad = Module._load.bind(Module);
  const resolvedPath = require.resolve(modulePath);
  delete require.cache[resolvedPath];

  Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) {
      return mocks[request];
    }
    return originalLoad(request, parent, isMain);
  };

  return {
    module: require(modulePath),
    restore() {
      Module._load = originalLoad;
      delete require.cache[resolvedPath];
    },
  };
}

test('assertCodebiteAgenticSupport maps Vercel-routed GPT-5.4 Nano to Codebite config', () => {
  const { assertCodebiteAgenticSupport } = require('../../dist/core/runtime/codebite/index');

  assert.deepEqual(
    assertCodebiteAgenticSupport({
      model: 'vercel/openai/gpt-5.4-nano',
      transport: 'auto',
      apiBaseUrl: undefined,
    }),
    {
      provider: 'vercel',
      model: 'openai/gpt-5.4-nano',
      apiKey: '',
      maxSteps: 30,
      deepMode: false,
      tools: {},
    },
  );
});

test('assertCodebiteAgenticSupport rejects unsupported agentic providers with actionable guidance', () => {
  const { assertCodebiteAgenticSupport } = require('../../dist/core/runtime/codebite/index');

  assert.throws(
    () => assertCodebiteAgenticSupport({
      model: 'openrouter/anthropic/claude-sonnet-4-5',
      transport: 'auto',
      apiBaseUrl: undefined,
    }),
    /Supported providers: openai, anthropic, google, mistral, vercel/,
  );
});

test('assertCodebiteAgenticSupport rejects custom apiBaseUrl overrides', () => {
  const { assertCodebiteAgenticSupport } = require('../../dist/core/runtime/codebite/index');

  assert.throws(
    () => assertCodebiteAgenticSupport({
      model: 'openai/gpt-5.4-nano',
      transport: 'openai',
      apiBaseUrl: 'https://gateway.example/v1',
    }),
    /does not support custom apiBaseUrl overrides/i,
  );
});

test('buildCodebiteWorkerScript imports Codebite from absolute file URLs', () => {
  const { buildCodebiteWorkerScript } = require('../../dist/core/runtime/codebite/index');
  const packageJsonPath = path.join('C:', 'repo', 'node_modules', 'codebite', 'package.json');

  const script = buildCodebiteWorkerScript(packageJsonPath);

  assert.match(script, /import \{ runAgent \} from "file:\/\/\/C:\/repo\/node_modules\/codebite\/dist\/agent\.js"/);
  assert.match(script, /import \{ resolveModel \} from "file:\/\/\/C:\/repo\/node_modules\/codebite\/dist\/provider\.js"/);
});

test('CodebiteAgentRuntime repairs invalid JSON output and validates it against the schema', async () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-codebite-runtime-'));
  const schema = z.object({ ok: z.boolean() });

  const fixture = loadWithMocks('../../dist/core/runtime/codebite/index', {
    execa: {
      __esModule: true,
      default: async (_command, _args, options) => {
        fs.writeFileSync(
          options.env.BATEYE_CODEBITE_OUTPUT,
          JSON.stringify({
            text: '{"ok":"wrong-type"}',
            usage: { inputTokens: 11, outputTokens: 7 },
          }),
          'utf-8',
        );
        return { stdout: '' };
      },
    },
    ai: {
      generateText: async () => ({
        text: '{"ok":true}',
        usage: { inputTokens: 5, outputTokens: 3 },
      }),
    },
    '../debug': {
      logRuntimeDebug: () => {},
    },
  });

  try {
    const runtime = new fixture.module.CodebiteAgentRuntime();
    const result = await runtime.runAgenticReview(
      {
        systemPrompt: 'Return JSON only.',
        userMessage: 'Report success.',
        model: 'vercel/openai/gpt-5.4-nano',
        apiKey: 'gateway-key',
        repoPath,
        transport: 'auto',
        initialFiles: ['src/index.ts'],
        timeoutMs: 5000,
      },
      schema,
    );

    assert.deepEqual(result.data, { ok: true });
    assert.equal(result.runtime, 'cli');
    assert.equal(result.rawResponse, '{"ok":true}');
    assert.deepEqual(result.tokensUsed, {
      inputTokens: 16,
      outputTokens: 10,
      estimated: false,
    });
  } finally {
    fixture.restore();
  }
});
