const test = require('node:test');
const assert = require('node:assert/strict');

const { buildProviderOptions } = require('../../dist/core/runtime/direct/index');
const { buildOpencodeServerConfig } = require('../../dist/core/runtime/opencode-cli/index');

// ─── buildProviderOptions ─────────────────────────────────────────────────────

test('buildProviderOptions returns undefined when effort is undefined', () => {
  assert.equal(buildProviderOptions('openai', undefined), undefined);
  assert.equal(buildProviderOptions('anthropic', undefined), undefined);
  assert.equal(buildProviderOptions('google', undefined), undefined);
});

test('buildProviderOptions returns undefined when effort is empty string', () => {
  assert.equal(buildProviderOptions('openai', ''), undefined);
});

test('buildProviderOptions maps openai transport to openai reasoningEffort', () => {
  assert.deepEqual(buildProviderOptions('openai', 'high'), {
    openai: { reasoningEffort: 'high' },
  });
});

test('buildProviderOptions maps azure transport to openai reasoningEffort shape', () => {
  assert.deepEqual(buildProviderOptions('azure', 'medium'), {
    openai: { reasoningEffort: 'medium' },
  });
});

test('buildProviderOptions maps vercel transport to openai reasoningEffort shape', () => {
  // Vercel AI Gateway is OpenAI-compatible; the openai shape passes through.
  assert.deepEqual(buildProviderOptions('vercel', 'high'), {
    openai: { reasoningEffort: 'high' },
  });
});

test('buildProviderOptions maps openrouter transport to openrouter reasoning effort', () => {
  assert.deepEqual(buildProviderOptions('openrouter', 'low'), {
    openrouter: { reasoning: { effort: 'low' } },
  });
});

test('buildProviderOptions maps groq transport to groq reasoningEffort', () => {
  assert.deepEqual(buildProviderOptions('groq', 'medium'), {
    groq: { reasoningEffort: 'medium' },
  });
});

test('buildProviderOptions maps anthropic transport to adaptive thinking block', () => {
  assert.deepEqual(buildProviderOptions('anthropic', 'high'), {
    anthropic: { thinking: { type: 'adaptive', effort: 'high' } },
  });
});

test('buildProviderOptions maps google transport using effort→budget translation for low', () => {
  const result = buildProviderOptions('google', 'low');
  assert.deepEqual(result, { google: { thinkingConfig: { thinkingBudget: 2048 } } });
});

test('buildProviderOptions maps google transport using effort→budget translation for high', () => {
  const result = buildProviderOptions('google', 'high');
  assert.deepEqual(result, { google: { thinkingConfig: { thinkingBudget: 24576 } } });
});

test('buildProviderOptions maps google transport: minimal effort → budget 0', () => {
  assert.deepEqual(buildProviderOptions('google', 'minimal'), {
    google: { thinkingConfig: { thinkingBudget: 0 } },
  });
});

test('buildProviderOptions maps google transport: xhigh effort → budget 32768', () => {
  assert.deepEqual(buildProviderOptions('google', 'xhigh'), {
    google: { thinkingConfig: { thinkingBudget: 32768 } },
  });
});

test('buildProviderOptions returns undefined for google with an unrecognized effort string', () => {
  // Unknown effort strings cannot be mapped to a token budget → silently omit.
  assert.equal(buildProviderOptions('google', 'turbo'), undefined);
});

test('buildProviderOptions returns undefined for an unknown transport (no throw)', () => {
  assert.equal(buildProviderOptions('unknown-provider', 'high'), undefined);
  assert.equal(buildProviderOptions('litellm', 'medium'), undefined);
});

// ─── buildOpencodeServerConfig ────────────────────────────────────────────────

const EXPECTED_CHUNK_TIMEOUT = 3_600_000;

test('buildOpencodeServerConfig with no overrides produces baseline chunkTimeout config', () => {
  const config = buildOpencodeServerConfig([]);

  // Each provider block must include a chunkTimeout option.
  for (const [providerName, block] of Object.entries(config.provider)) {
    assert.equal(
      block.options.chunkTimeout,
      EXPECTED_CHUNK_TIMEOUT,
      `provider ${providerName} must carry chunkTimeout`,
    );
    // Without overrides there must be no .models key.
    assert.equal(block.models, undefined, `provider ${providerName} should have no .models without overrides`);
  }
});

test('buildOpencodeServerConfig adds per-model reasoningEffort under the correct provider', () => {
  const overrides = [{ provider: 'anthropic', modelId: 'claude-sonnet-4-6', effort: 'high' }];
  const config = buildOpencodeServerConfig(overrides);

  assert.equal(
    config.provider.anthropic.models['claude-sonnet-4-6'].options.reasoningEffort,
    'high',
  );
  // chunkTimeout must still be present alongside the model entry.
  assert.equal(config.provider.anthropic.options.chunkTimeout, EXPECTED_CHUNK_TIMEOUT);
});

test('buildOpencodeServerConfig strips -thinking suffix from model IDs', () => {
  const overrides = [{ provider: 'openai', modelId: 'deepseek/deepseek-v3.2-thinking', effort: 'medium' }];
  const config = buildOpencodeServerConfig(overrides);

  // The key should be the stripped form, matching what OpenCode actually registers.
  assert.equal(
    config.provider.openai.models['deepseek/deepseek-v3.2'].options.reasoningEffort,
    'medium',
  );
  // The original key with the suffix must NOT exist.
  assert.equal(config.provider.openai.models['deepseek/deepseek-v3.2-thinking'], undefined);
});

test('buildOpencodeServerConfig supports multiple overrides across different providers', () => {
  const overrides = [
    { provider: 'openai', modelId: 'gpt-5', effort: 'high' },
    { provider: 'anthropic', modelId: 'claude-sonnet-4-6', effort: 'low' },
  ];
  const config = buildOpencodeServerConfig(overrides);

  assert.equal(config.provider.openai.models['gpt-5'].options.reasoningEffort, 'high');
  assert.equal(config.provider.anthropic.models['claude-sonnet-4-6'].options.reasoningEffort, 'low');
  // chunkTimeout on each provider block must be untouched.
  assert.equal(config.provider.openai.options.chunkTimeout, EXPECTED_CHUNK_TIMEOUT);
  assert.equal(config.provider.anthropic.options.chunkTimeout, EXPECTED_CHUNK_TIMEOUT);
});

test('buildOpencodeServerConfig with multiple overrides for the same provider accumulates model entries', () => {
  const overrides = [
    { provider: 'openai', modelId: 'gpt-5', effort: 'high' },
    { provider: 'openai', modelId: 'gpt-5.2', effort: 'medium' },
  ];
  const config = buildOpencodeServerConfig(overrides);

  assert.equal(config.provider.openai.models['gpt-5'].options.reasoningEffort, 'high');
  assert.equal(config.provider.openai.models['gpt-5.2'].options.reasoningEffort, 'medium');
  // Only one provider block entry, not two.
  assert.equal(Object.keys(config.provider.openai.models).length, 2);
});
