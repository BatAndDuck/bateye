const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  isDiagnosticModeEnabled,
  resolveDiagnosticDir,
} = require('../../dist/core/output/diagnostics');

test('isDiagnosticModeEnabled is false by default', () => {
  assert.equal(isDiagnosticModeEnabled({}), false);
});

test('isDiagnosticModeEnabled recognizes truthy env values', () => {
  assert.equal(isDiagnosticModeEnabled({ BATEYE_DIAGNOSTIC: '1' }), true);
  assert.equal(isDiagnosticModeEnabled({ BATEYE_DIAGNOSTIC: 'true' }), true);
});

test('resolveDiagnosticDir returns the explicit diagnostic directory when configured', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-diagnostics-repo-'));
  const explicitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-diagnostics-out-'));
  assert.equal(
    resolveDiagnosticDir(repoPath, { BATEYE_DIAGNOSTIC: '1', BATEYE_DIAGNOSTIC_DIR: explicitDir }),
    path.resolve(explicitDir),
  );
});

test('resolveDiagnosticDir falls back to the repository diagnostics folder', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-diagnostics-repo-'));
  assert.equal(
    resolveDiagnosticDir(repoPath, { BATEYE_DIAGNOSTIC: '1' }),
    path.join(path.resolve(repoPath), '.bateye', 'out', 'diagnostics'),
  );
});
