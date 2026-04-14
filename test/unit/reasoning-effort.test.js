const test = require('node:test');
const assert = require('node:assert/strict');

const { buildProviderOptions } = require('../../dist/core/runtime/direct/index');

test('buildProviderOptions returns undefined when effort is undefined', () => {
  assert.equal(buildProviderOptions('openai', undefined), undefined);
  assert.equal(buildProviderOptions('anthropic', undefined), undefined);
  assert.equal(buildProviderOptions('google', undefined), undefined);
  assert.equal(buildProviderOptions('mistral', undefined), undefined);
});

test('buildProviderOptions returns undefined when effort is empty string', () => {
  assert.equal(buildProviderOptions('openai', ''), undefined);
});

test('buildProviderOptions maps openai transport to openai reasoningEffort', () => {
  assert.deepEqual(buildProviderOptions('openai', 'high'), {
    openai: { reasoningEffort: 'high' },
  });
});

test('buildProviderOptions maps vercel transport to openai reasoningEffort shape', () => {
  assert.deepEqual(buildProviderOptions('vercel', 'high'), {
    openai: { reasoningEffort: 'high' },
  });
});

test('buildProviderOptions maps anthropic transport to adaptive thinking block', () => {
  assert.deepEqual(buildProviderOptions('anthropic', 'high'), {
    anthropic: { thinking: { type: 'adaptive', effort: 'high' } },
  });
});

test('buildProviderOptions maps google transport using effort to budget translation for low', () => {
  assert.deepEqual(buildProviderOptions('google', 'low'), {
    google: { thinkingConfig: { thinkingBudget: 2048 } },
  });
});

test('buildProviderOptions maps google transport using effort to budget translation for high', () => {
  assert.deepEqual(buildProviderOptions('google', 'high'), {
    google: { thinkingConfig: { thinkingBudget: 24576 } },
  });
});

test('buildProviderOptions maps google transport minimal effort to budget 0', () => {
  assert.deepEqual(buildProviderOptions('google', 'minimal'), {
    google: { thinkingConfig: { thinkingBudget: 0 } },
  });
});

test('buildProviderOptions maps google transport xhigh effort to budget 32768', () => {
  assert.deepEqual(buildProviderOptions('google', 'xhigh'), {
    google: { thinkingConfig: { thinkingBudget: 32768 } },
  });
});

test('buildProviderOptions returns undefined for google with an unrecognized effort string', () => {
  assert.equal(buildProviderOptions('google', 'turbo'), undefined);
});

test('buildProviderOptions maps mistral minimal to none and high/xhigh to high', () => {
  assert.deepEqual(buildProviderOptions('mistral', 'minimal'), {
    mistral: { reasoningEffort: 'none' },
  });
  assert.deepEqual(buildProviderOptions('mistral', 'high'), {
    mistral: { reasoningEffort: 'high' },
  });
  assert.deepEqual(buildProviderOptions('mistral', 'xhigh'), {
    mistral: { reasoningEffort: 'high' },
  });
});

test('buildProviderOptions omits ambiguous mistral low and medium efforts', () => {
  assert.equal(buildProviderOptions('mistral', 'low'), undefined);
  assert.equal(buildProviderOptions('mistral', 'medium'), undefined);
});

test('buildProviderOptions returns undefined for an unknown transport', () => {
  assert.equal(buildProviderOptions('unknown-provider', 'high'), undefined);
});
