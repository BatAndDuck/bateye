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
      disableSubagents: false,
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
    /Supported providers: openai, anthropic, google, mistral, vercel, groq, xai, cohere, deepseek, bedrock, azure, togetherai, fireworks, litellm/,
  );
});

test('assertCodebiteAgenticSupport requires apiBaseUrl for azure and preserves it in runtime config', () => {
  const { assertCodebiteAgenticSupport } = require('../../dist/core/runtime/codebite/index');

  assert.throws(
    () => assertCodebiteAgenticSupport({
      model: 'azure/my-deployment',
      transport: 'auto',
      apiBaseUrl: undefined,
    }),
    /requires apiBaseUrl/i,
  );

  assert.deepEqual(
    assertCodebiteAgenticSupport({
      model: 'azure/my-deployment',
      transport: 'auto',
      apiBaseUrl: 'https://azure.example.openai.azure.com/openai',
    }),
    {
      provider: 'azure',
      model: 'my-deployment',
      apiKey: '',
      baseURL: 'https://azure.example.openai.azure.com/openai',
      maxSteps: 30,
      deepMode: false,
      disableSubagents: false,
      tools: {},
    },
  );
});

test('buildCodebiteWorkerScript imports Codebite from absolute file URLs', () => {
  const { buildCodebiteWorkerScript } = require('../../dist/core/runtime/codebite/index');
  const packageJsonPath = path.join('C:', 'repo', 'node_modules', 'codebite', 'package.json');

  const script = buildCodebiteWorkerScript(packageJsonPath);

  assert.match(script, /import \{ runAgent \} from "file:\/\/\/.+node_modules\/codebite\/dist\/agent\.js"/);
  assert.match(script, /import \{ createGateway \} from "file:\/\/\//);
  assert.match(script, /import \{ createOpenAI \} from "file:\/\/\//);
  assert.match(script, /import \{ createAmazonBedrock \} from "file:\/\/\//);
  assert.match(script, /import \{ Agent \} from "file:\/\/\//);
  assert.match(script, /headersTimeout: gatewayRequestTimeoutMs/);
  assert.match(script, /function resolveModel\(config\)/);
  assert.match(script, /payload\.diagnosticsPath/);
});

test('CodebiteAgentRuntime forwards maxSteps, deepMode, disableSubagents, and diagnosticsPath to Codebite 0.5.0', async () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-codebite-config-'));
  const schema = z.object({ ok: z.boolean() });
  const originalDiagnosticFlag = process.env.BATEYE_DIAGNOSTIC;
  const originalDiagnosticDir = process.env.BATEYE_DIAGNOSTIC_DIR;
  let capturedPayload;

  process.env.BATEYE_DIAGNOSTIC = '1';
  process.env.BATEYE_DIAGNOSTIC_DIR = path.join(repoPath, 'diagnostics');

  const fixture = loadWithMocks('../../dist/core/runtime/codebite/index', {
    execa: {
      __esModule: true,
      default: async (_command, _args, options) => {
        capturedPayload = JSON.parse(fs.readFileSync(options.env.BATEYE_CODEBITE_INPUT, 'utf-8'));
        fs.writeFileSync(
          options.env.BATEYE_CODEBITE_OUTPUT,
          JSON.stringify({
            text: '{"ok":true}',
            usage: { inputTokens: 13, outputTokens: 5 },
          }),
          'utf-8',
        );
        return { stdout: '', stderr: '' };
      },
    },
    '../debug': {
      logRuntimeDebug: () => {},
    },
  });

  try {
    const runtime = new fixture.module.CodebiteAgentRuntime();
    const result = await runtime.runAgenticReview(
      {
        systemPrompt: 'Plan the review.',
        userMessage: 'Investigate deeply.',
        model: 'vercel/openai/gpt-5.4-nano',
        apiKey: 'gateway-key',
        repoPath,
        transport: 'auto',
        initialFiles: ['src/index.ts'],
        timeoutMs: 5000,
        maxSteps: 150,
        deepMode: true,
        disableSubagents: false,
        callLabel: 'pr-planner',
      },
      schema,
    );

    assert.deepEqual(result.data, { ok: true });
    assert.equal(capturedPayload.config.maxSteps, 150);
    assert.equal(capturedPayload.config.deepMode, true);
    assert.equal(capturedPayload.config.disableSubagents, false);
    assert.match(capturedPayload.diagnosticsPath, /pr-planner\.codebite\.jsonl$/);
  } finally {
    fixture.restore();
    if (originalDiagnosticFlag === undefined) delete process.env.BATEYE_DIAGNOSTIC;
    else process.env.BATEYE_DIAGNOSTIC = originalDiagnosticFlag;
    if (originalDiagnosticDir === undefined) delete process.env.BATEYE_DIAGNOSTIC_DIR;
    else process.env.BATEYE_DIAGNOSTIC_DIR = originalDiagnosticDir;
  }
});

test('CodebiteAgentRuntime resolves Vercel gateway credentials from AI_GATEWAY_API_KEY for Codebite runs', async () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-codebite-vercel-credential-'));
  const schema = z.object({ ok: z.boolean() });
  const originalGatewayApiKey = process.env.AI_GATEWAY_API_KEY;
  let capturedPayload;

  process.env.AI_GATEWAY_API_KEY = 'gateway-env-key';

  const fixture = loadWithMocks('../../dist/core/runtime/codebite/index', {
    execa: {
      __esModule: true,
      default: async (_command, _args, options) => {
        capturedPayload = JSON.parse(fs.readFileSync(options.env.BATEYE_CODEBITE_INPUT, 'utf-8'));
        fs.writeFileSync(
          options.env.BATEYE_CODEBITE_OUTPUT,
          JSON.stringify({
            text: '{"ok":true}',
            usage: { inputTokens: 7, outputTokens: 3 },
          }),
          'utf-8',
        );
        return { stdout: '', stderr: '' };
      },
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
        apiKey: '',
        repoPath,
        transport: 'auto',
        initialFiles: ['src/index.ts'],
        timeoutMs: 5000,
      },
      schema,
    );

    assert.deepEqual(result.data, { ok: true });
    assert.equal(capturedPayload.config.apiKey, 'gateway-env-key');
  } finally {
    fixture.restore();
    if (originalGatewayApiKey === undefined) delete process.env.AI_GATEWAY_API_KEY;
    else process.env.AI_GATEWAY_API_KEY = originalGatewayApiKey;
  }
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

test('CodebiteAgentRuntime locally repairs malformed escape sequences before calling the repair model', async () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-codebite-escape-repair-'));
  const schema = z.object({ note: z.string() });
  let repairCalls = 0;

  const fixture = loadWithMocks('../../dist/core/runtime/codebite/index', {
    execa: {
      __esModule: true,
      default: async (_command, _args, options) => {
        fs.writeFileSync(
          options.env.BATEYE_CODEBITE_OUTPUT,
          JSON.stringify({
            text: String.raw`{"note":"bad\q escape in JSON"}`,
            usage: { inputTokens: 9, outputTokens: 6 },
          }),
          'utf-8',
        );
        return { stdout: '', stderr: '' };
      },
    },
    ai: {
      generateText: async () => {
        repairCalls += 1;
        return { text: '{"note":"should not be used"}' };
      },
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

    assert.deepEqual(result.data, { note: 'bad\\q escape in JSON' });
    assert.equal(repairCalls, 0);
  } finally {
    fixture.restore();
  }
});

test('CodebiteAgentRuntime retries once internally after a first-pass parse failure and stores the raw bad response in diagnostics even without --diagnostics', async () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-codebite-retry-'));
  const schema = z.object({ ok: z.boolean() });
  let execaCalls = 0;
  const capturedPayloads = [];

  const fixture = loadWithMocks('../../dist/core/runtime/codebite/index', {
    execa: {
      __esModule: true,
      default: async (_command, _args, options) => {
        execaCalls += 1;
        capturedPayloads.push(JSON.parse(fs.readFileSync(options.env.BATEYE_CODEBITE_INPUT, 'utf-8')));

        const text = execaCalls === 1
          ? String.raw`{"ok": tru\q}`
          : '{"ok":true}';

        fs.writeFileSync(
          options.env.BATEYE_CODEBITE_OUTPUT,
          JSON.stringify({
            text,
            usage: { inputTokens: 10 * execaCalls, outputTokens: 5 * execaCalls },
          }),
          'utf-8',
        );
        return { stdout: `attempt-${execaCalls}`, stderr: '' };
      },
    },
    ai: {
      generateText: async () => ({
        text: String.raw`{"ok": tru\q}`,
        usage: { inputTokens: 3, outputTokens: 2 },
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
        callLabel: 'reviewer:Code Quality',
      },
      schema,
    );

    assert.deepEqual(result.data, { ok: true });
    assert.equal(execaCalls, 2);
    assert.match(capturedPayloads[1].question, /Retry Notice/);

    const diagnosticsDir = path.join(repoPath, '.bateye', 'out', 'diagnostics');
    const artifactFiles = fs.readdirSync(diagnosticsDir);
    const rawFile = artifactFiles.find(file => file.endsWith('.codebite.parse-failure.raw.txt'));
    const traceFile = artifactFiles.find(file => file.endsWith('.codebite.parse-failure.trace.md'));
    assert.ok(rawFile, 'expected a raw parse-failure artifact');
    assert.ok(traceFile, 'expected a trace parse-failure artifact');
    assert.match(fs.readFileSync(path.join(diagnosticsDir, rawFile), 'utf-8'), /\{"ok": tru\\q\}/);
  } finally {
    fixture.restore();
  }
});

test('CodebiteAgentRuntime surfaces worker stderr when the Codebite subprocess exits before writing output', async () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-codebite-worker-failure-'));
  const schema = z.object({ ok: z.boolean() });

  const fixture = loadWithMocks('../../dist/core/runtime/codebite/index', {
    execa: {
      __esModule: true,
      default: async () => {
        const error = new Error('Command failed with exit code 1: node');
        error.exitCode = 1;
        error.stderr = 'Provider returned 503 Service Unavailable';
        error.stdout = '';
        throw error;
      },
    },
    '../debug': {
      logRuntimeDebug: () => {},
    },
  });

  try {
    const runtime = new fixture.module.CodebiteAgentRuntime();
    await assert.rejects(
      runtime.runAgenticReview(
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
      ),
      /Codebite worker process failed before producing a response \(exitCode=1; stderr: Provider returned 503 Service Unavailable\)/,
    );
  } finally {
    fixture.restore();
  }
});
