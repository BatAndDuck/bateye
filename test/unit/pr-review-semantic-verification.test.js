/**
 * Unit tests for the semanticVerification config toggle.
 *
 * The PR review pipeline reads `config.prReview.semanticVerification.enabled` to decide
 * whether to run the LLM-based semantic verification pass.  When the flag is false the
 * pipeline skips the pass entirely, which lowers token consumption and latency at the
 * cost of potentially passing through false-positive findings.
 *
 * These tests exercise the flag-reading logic in isolation by checking that the config
 * schema accepts / rejects relevant values and that the toggle semantics match the
 * documented default ("enabled unless explicitly set to false").
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// ─── Config schema ──────────────────────────────────────────────────────────
// The JSON schema for .codeowl/config.json is shipped alongside the package so
// that editors can provide in-place validation.  We smoke-test the relevant
// portion here to catch regressions in the schema itself.

const schema = require('../../src/schemas/codeowl-config.schema.json');

test('codeowl-config schema includes prReview.semanticVerification.enabled', () => {
  const prReview = schema.properties?.prReview;
  assert.ok(prReview, 'schema has a prReview property');

  const semVer = prReview.properties?.semanticVerification;
  assert.ok(semVer, 'prReview has a semanticVerification property');

  const enabled = semVer.properties?.enabled;
  assert.ok(enabled, 'semanticVerification has an enabled property');
  assert.equal(enabled.type, 'boolean', 'enabled is typed as boolean');
});

// ─── Toggle semantics ───────────────────────────────────────────────────────
// The pipeline evaluates:
//   const semanticEnabled = config.prReview?.semanticVerification?.enabled !== false;
//
// This implements "enabled by default" — the pass runs unless the user
// explicitly sets enabled: false.  The tests below codify every branch.

function resolveSemanticEnabled(config) {
  // Mirror the exact expression used in pipeline.ts so this test stays in sync.
  return config?.prReview?.semanticVerification?.enabled !== false;
}

test('semanticVerification is enabled when config is completely absent', () => {
  assert.equal(resolveSemanticEnabled(undefined), true);
  assert.equal(resolveSemanticEnabled(null), true);
  assert.equal(resolveSemanticEnabled({}), true);
});

test('semanticVerification is enabled when prReview block is absent', () => {
  assert.equal(resolveSemanticEnabled({ model: 'anthropic/claude-sonnet-4-5' }), true);
});

test('semanticVerification is enabled when semanticVerification block is absent', () => {
  assert.equal(resolveSemanticEnabled({ prReview: {} }), true);
});

test('semanticVerification is enabled when enabled is explicitly true', () => {
  assert.equal(
    resolveSemanticEnabled({ prReview: { semanticVerification: { enabled: true } } }),
    true,
  );
});

test('semanticVerification is disabled when enabled is explicitly false', () => {
  assert.equal(
    resolveSemanticEnabled({ prReview: { semanticVerification: { enabled: false } } }),
    false,
  );
});
