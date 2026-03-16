const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  resolveBundledOpenCodeInvocation,
  resolveOpenCodeInvocation,
} = require('../../dist/core/runtime/opencode-cli/command');

test('resolveBundledOpenCodeInvocation maps package metadata to a bundled node invocation', () => {
  const packageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codeowl-opencode-package-'));
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
  const packageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codeowl-opencode-invalid-'));
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
