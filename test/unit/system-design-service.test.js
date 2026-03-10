const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { resolveSystemDesignTemplatePath } = require('../../dist/features/system-design/application/system-design-service');

test('resolveSystemDesignTemplatePath returns a feature-owned asset', () => {
  const templatePath = resolveSystemDesignTemplatePath();
  assert.ok(fs.existsSync(templatePath));
  assert.match(templatePath, /features[\\/]system-design[\\/]assets[\\/]index\.html$/);
});
