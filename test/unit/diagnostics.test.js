const test = require('node:test');
const assert = require('node:assert/strict');

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
  assert.equal(
    resolveDiagnosticDir('C:\\repo', { BATEYE_DIAGNOSTIC: '1', BATEYE_DIAGNOSTIC_DIR: 'C:\\logs\\bateye' }),
    'C:\\logs\\bateye',
  );
});

test('resolveDiagnosticDir falls back to the repository diagnostics folder', () => {
  assert.equal(
    resolveDiagnosticDir('C:\\repo', { BATEYE_DIAGNOSTIC: '1' }),
    'C:\\repo\\.bateye\\out\\diagnostics',
  );
});
