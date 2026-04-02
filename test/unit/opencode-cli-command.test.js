const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  MAX_INLINE_OPEN_CODE_PROMPT_CHARS,
  OPEN_CODE_PROMPT_ATTACHMENT_MESSAGE,
  buildOpenCodeEnvironment,
  buildOpenCodeRunArguments,
  resolveBundledOpenCodeInvocation,
  resolveOpenCodeInvocation,
} = require('../../dist/core/runtime/opencode-cli/command');

test('resolveBundledOpenCodeInvocation maps package metadata to a bundled node invocation', () => {
  const packageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-opencode-package-'));
  const packageJsonPath = path.join(packageDir, 'package.json');
  const binPath = path.join(packageDir, 'bin', 'opencode');

  fs.mkdirSync(path.dirname(binPath), { recursive: true });
  fs.writeFileSync(packageJsonPath, JSON.stringify({
    name: 'opencode-ai',
    bin: {
      opencode: 'bin/opencode',
    },
  }, null, 2));
  fs.writeFileSync(binPath, '#!/usr/bin/env node\n');

  assert.deepEqual(resolveBundledOpenCodeInvocation(packageJsonPath), {
    command: process.execPath,
    args: [binPath],
    source: 'bundled',
  });
});

test('resolveBundledOpenCodeInvocation returns null when the package has no usable bin', () => {
  const packageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-opencode-invalid-'));
  const packageJsonPath = path.join(packageDir, 'package.json');

  fs.writeFileSync(packageJsonPath, JSON.stringify({ name: 'opencode-ai' }, null, 2));

  assert.equal(resolveBundledOpenCodeInvocation(packageJsonPath), null);
  assert.equal(resolveBundledOpenCodeInvocation(null), null);
});

test('resolveOpenCodeInvocation prefers the bundled opencode-ai dependency', () => {
  const invocation = resolveOpenCodeInvocation();

  assert.equal(invocation.source, 'bundled');
  assert.equal(invocation.command, process.execPath);
  assert.match(invocation.args[0], /opencode-ai[\\/]+bin[\\/]+opencode$/);
  assert.equal(fs.existsSync(invocation.args[0]), true);
});

test('buildOpenCodeRunArguments uses supported file-attachment syntax with a leading message', () => {
  const args = buildOpenCodeRunArguments(
    { command: process.execPath, args: ['opencode'], source: 'bundled' },
    { model: 'anthropic/claude-sonnet-4-5' },
    'x'.repeat(MAX_INLINE_OPEN_CODE_PROMPT_CHARS + 1),
    'C:\\temp\\prompt.txt',
  );

  assert.deepEqual(args, [
    'opencode',
    'run',
    OPEN_CODE_PROMPT_ATTACHMENT_MESSAGE,
    '--model',
    'anthropic/claude-sonnet-4-5',
    '--file',
    'C:\\temp\\prompt.txt',
  ]);
  assert.equal(args.includes('--no-interactive'), false);
});

test('buildOpenCodeRunArguments inlines smaller prompts directly', () => {
  const prompt = 'Return exactly {"ok":true}.';
  const args = buildOpenCodeRunArguments(
    { command: process.execPath, args: ['opencode'], source: 'bundled' },
    { model: 'anthropic/claude-sonnet-4-5' },
    prompt,
    'C:\\temp\\prompt.txt',
  );

  assert.deepEqual(args, [
    'opencode',
    'run',
    '--model',
    'anthropic/claude-sonnet-4-5',
    '--',
    prompt,
  ]);
});

test('buildOpenCodeEnvironment maps BatEye credentials onto OpenCode-compatible env vars', () => {
  const env = buildOpenCodeEnvironment({}, {
    apiKey: 'secret-key',
    model: 'anthropic/claude-sonnet-4-5',
    transport: 'auto',
    apiBaseUrl: undefined,
  });

  assert.equal(env.ANTHROPIC_API_KEY, 'secret-key');
  assert.equal(env.OPENAI_API_KEY, undefined);
});

test('buildOpenCodeEnvironment uses OpenAI-compatible gateway env for vercel transport', () => {
  const env = buildOpenCodeEnvironment({}, {
    apiKey: 'gateway-key',
    model: 'anthropic/claude-sonnet-4-5',
    transport: 'vercel',
    apiBaseUrl: undefined,
  });

  assert.equal(env.AI_GATEWAY_API_KEY, 'gateway-key');
  assert.equal(env.OPENAI_API_KEY, 'gateway-key');
  assert.equal(env.OPENAI_BASE_URL, 'https://ai-gateway.vercel.sh/v1');
});

test('buildOpenCodeEnvironment routes explicit apiBaseUrl through OpenAI-compatible env vars', () => {
  const env = buildOpenCodeEnvironment({}, {
    apiKey: 'gateway-key',
    model: 'anthropic/claude-sonnet-4-5',
    transport: 'auto',
    apiBaseUrl: 'https://litellm.example.com/v1',
  });

  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.OPENAI_API_KEY, 'gateway-key');
  assert.equal(env.OPENAI_BASE_URL, 'https://litellm.example.com/v1');
});
