const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

function withCapturedConsole(run) {
  const originalLog = console.log;
  const lines = [];
  console.log = (...args) => {
    lines.push(args.join(' '));
  };

  return Promise.resolve()
    .then(() => run(lines))
    .finally(() => {
      console.log = originalLog;
    });
}

function loadCommandWithMocks(commandModulePath, mocks) {
  const originalLoad = Module._load.bind(Module);
  const commandKey = require.resolve(commandModulePath);
  delete require.cache[commandKey];

  Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) {
      return mocks[request];
    }

    return originalLoad(request, parent, isMain);
  };

  return {
    module: require(commandModulePath),
    restore() {
      Module._load = originalLoad;
      delete require.cache[commandKey];
    },
  };
}

test('runDoctor reports when the API key comes from the BatEye credential store', async () => {
  const originalApiKey = process.env.BATEYE_LLM_MODEL_API_KEY;
  delete process.env.BATEYE_LLM_MODEL_API_KEY;
  const fixture = loadCommandWithMocks('../../dist/commands/doctor/index', {
    fs: { existsSync: () => true },
    path: require('node:path'),
    chalk: {
      __esModule: true,
      default: {
        cyan: value => value,
        green: value => value,
        yellow: value => value,
        red: value => value,
        white: value => value,
        gray: value => value,
      },
    },
    execa: {
      __esModule: true,
      default: async () => ({ stdout: '1.2.27' }),
    },
    '../../core/config/loader': {
      loadConfig: () => ({ model: 'openai/gpt-5.4-nano' }),
      resolveConfig: () => ({ model: 'openai/gpt-5.4-nano', transport: 'auto', exclude: [] }),
    },
    '../../core/config/defaults': {
      CONFIG_FILE: '.bateye/config.json',
    },
    '../../core/reviewers/loader': {
      loadReviewers: () => ({ reviewers: [{ id: 'security-api' }], warnings: [] }),
    },
    '../../core/git/index': {
      isGitRepo: async () => true,
    },
    '../../features/config/application/config-service': {
      resolveApiKey: () => 'stored-key-123456',
      resolveAuthEnvName: () => 'BATEYE_LLM_MODEL_API_KEY',
    },
    '../../features/config/application/credential-store': {
      resolveStoredApiKey: () => 'stored-key-123456',
      maskApiKey: value => `***${value.slice(-4)}`,
    },
    '../../core/runtime/opencode-cli/command': {
      resolveOpenCodeInvocation: () => ({ command: 'node', args: ['opencode'], source: 'bundled' }),
    },
  });

  try {
    await withCapturedConsole(async lines => {
      await fixture.module.runDoctor('C:\\repo');
      const output = lines.join('\n');
      assert.match(output, /API key \(BATEYE_LLM_MODEL_API_KEY\).*from BatEye credential store/);
      assert.match(output, /OpenCode CLI.*1\.2\.27 \(bundled with BatEye\)/);
      assert.match(output, /Model - openai\/gpt-5\.4-nano/);
    });
  } finally {
    if (originalApiKey === undefined) {
      delete process.env.BATEYE_LLM_MODEL_API_KEY;
    } else {
      process.env.BATEYE_LLM_MODEL_API_KEY = originalApiKey;
    }
    fixture.restore();
  }
});

test('runModels uses the matching apiBaseUrl and prints the quick conf hint', async () => {
  const listCalls = [];
  class MockOpenCodeRuntime {
    async listModels(provider, apiKey, apiBaseUrl) {
      listCalls.push({ provider, apiKey, apiBaseUrl });
      return ['gpt-5.4-nano', 'gpt-5.4-mini'];
    }
  }

  const fixture = loadCommandWithMocks('../../dist/commands/models/index', {
    chalk: {
      __esModule: true,
      default: {
        cyan: value => value,
        red: value => value,
        white: value => value,
        gray: value => value,
      },
    },
    '../../core/config/loader': {
      resolveConfig: () => ({
        model: 'openai/gpt-5.4-nano',
        transport: 'openai',
        apiBaseUrl: 'https://gateway.example/v1',
        exclude: [],
      }),
      resolveApiKey: () => 'repo-key',
    },
    '../../core/runtime/opencode-cli/index': {
      OpenCodeCLIRuntime: MockOpenCodeRuntime,
    },
    '../../core/runtime/interface': {
      parseProviderAndModel: model => {
        const [provider, ...rest] = model.split('/');
        return { provider, modelId: rest.join('/') };
      },
    },
  });

  try {
    await withCapturedConsole(async lines => {
      await fixture.module.runModels('C:\\repo');
      const output = lines.join('\n');
      assert.equal(listCalls.length, 1);
      assert.deepEqual(listCalls[0], {
        provider: 'openai',
        apiKey: 'repo-key',
        apiBaseUrl: 'https://gateway.example/v1',
      });
      assert.match(output, /Quick setup:\s+bateye conf --model openai\/gpt-5\.4-nano --apikey <key>/);
      assert.match(output, /gpt-5\.4-nano.*configured/);
    });
  } finally {
    fixture.restore();
  }
});
