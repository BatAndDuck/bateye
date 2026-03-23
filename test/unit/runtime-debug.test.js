const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isRuntimeDebugEnabled,
} = require('../../dist/core/runtime/debug');

test('isRuntimeDebugEnabled is false by default', () => {
  assert.equal(isRuntimeDebugEnabled({}), false);
});

test('isRuntimeDebugEnabled recognizes truthy verbose env values', () => {
  assert.equal(isRuntimeDebugEnabled({ BATEYE_VERBOSE: '1' }), true);
  assert.equal(isRuntimeDebugEnabled({ BATEYE_VERBOSE: 'true' }), true);
  assert.equal(isRuntimeDebugEnabled({ BATEYE_DEBUG_RUNTIME: 'on' }), true);
});
