const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

require('ts-node/register/transpile-only');

const {
  parseBenchmarkCliArgs,
  resolveBenchmarkGitHubToken,
  resolveBenchmarkLlmApiKey,
} = require('../../scripts/benchmark.ts');

function makeTmpRepo() {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-benchmark-'));
  fs.mkdirSync(path.join(repoPath, '.bateye'), { recursive: true });
  return repoPath;
}

test('resolveBenchmarkGitHubToken falls back to githubToken from .bateye/config.local.json', () => {
  const repoPath = makeTmpRepo();
  const originalBenchToken = process.env.GH_BATEYE_BENCHMARK_TOKEN;
  const originalGitHubToken = process.env.GITHUB_TOKEN;
  delete process.env.GH_BATEYE_BENCHMARK_TOKEN;
  delete process.env.GITHUB_TOKEN;

  fs.writeFileSync(
    path.join(repoPath, '.bateye', 'config.local.json'),
    JSON.stringify({ githubToken: 'config-github-token' }, null, 2),
  );

  try {
    assert.equal(resolveBenchmarkGitHubToken(repoPath), 'config-github-token');
  } finally {
    if (originalBenchToken === undefined) delete process.env.GH_BATEYE_BENCHMARK_TOKEN;
    else process.env.GH_BATEYE_BENCHMARK_TOKEN = originalBenchToken;

    if (originalGitHubToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = originalGitHubToken;
  }
});

test('resolveBenchmarkGitHubToken prefers GH_BATEYE_BENCHMARK_TOKEN over config and GITHUB_TOKEN', () => {
  const repoPath = makeTmpRepo();
  const originalBenchToken = process.env.GH_BATEYE_BENCHMARK_TOKEN;
  const originalGitHubToken = process.env.GITHUB_TOKEN;
  process.env.GH_BATEYE_BENCHMARK_TOKEN = 'explicit-benchmark-token';
  process.env.GITHUB_TOKEN = 'env-github-token';

  fs.writeFileSync(
    path.join(repoPath, '.bateye', 'config.local.json'),
    JSON.stringify({ githubToken: 'config-github-token' }, null, 2),
  );

  try {
    assert.equal(resolveBenchmarkGitHubToken(repoPath), 'explicit-benchmark-token');
  } finally {
    if (originalBenchToken === undefined) delete process.env.GH_BATEYE_BENCHMARK_TOKEN;
    else process.env.GH_BATEYE_BENCHMARK_TOKEN = originalBenchToken;

    if (originalGitHubToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = originalGitHubToken;
  }
});

test('resolveBenchmarkLlmApiKey uses local apiKey for the Vercel-routed benchmark runtime', () => {
  const repoPath = makeTmpRepo();
  const originalDefaultKey = process.env.BATEYE_LLM_MODEL_API_KEY;
  const originalGatewayKey = process.env.AI_GATEWAY_API_KEY;
  const originalOidcToken = process.env.VERCEL_OIDC_TOKEN;
  delete process.env.BATEYE_LLM_MODEL_API_KEY;
  delete process.env.AI_GATEWAY_API_KEY;
  delete process.env.VERCEL_OIDC_TOKEN;

  fs.writeFileSync(
    path.join(repoPath, '.bateye', 'config.local.json'),
    JSON.stringify({ apiKey: 'config-vercel-key' }, null, 2),
  );

  try {
    assert.equal(
      resolveBenchmarkLlmApiKey(repoPath, 'openai/gpt-5.4-nano'),
      'config-vercel-key',
    );
  } finally {
    if (originalDefaultKey === undefined) delete process.env.BATEYE_LLM_MODEL_API_KEY;
    else process.env.BATEYE_LLM_MODEL_API_KEY = originalDefaultKey;

    if (originalGatewayKey === undefined) delete process.env.AI_GATEWAY_API_KEY;
    else process.env.AI_GATEWAY_API_KEY = originalGatewayKey;

    if (originalOidcToken === undefined) delete process.env.VERCEL_OIDC_TOKEN;
    else process.env.VERCEL_OIDC_TOKEN = originalOidcToken;
  }
});

test('parseBenchmarkCliArgs recognizes --diagnostics', () => {
  const parsed = parseBenchmarkCliArgs([
    '--model',
    'openai/gpt-5.4-nano',
    '--pr',
    'https://github.com/BatAndDuck/bateye/pull/20',
    '--diagnostics',
  ]);

  assert.equal(parsed.model, 'openai/gpt-5.4-nano');
  assert.equal(parsed.prUrl, 'https://github.com/BatAndDuck/bateye/pull/20');
  assert.equal(parsed.diagnostics, true);
});
