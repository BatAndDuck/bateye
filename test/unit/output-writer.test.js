const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  ensureDir,
  writeJson,
  writeText,
} = require('../../dist/core/output/writer');

test('ensureDir creates a new nested directory', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-writer-'));
  const target = path.join(tmpDir, 'new', 'nested', 'dir');
  ensureDir(target);
  assert.ok(fs.existsSync(target));
  assert.ok(fs.statSync(target).isDirectory());
});

test('ensureDir does not throw if directory already exists', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-writer-'));
  assert.doesNotThrow(() => ensureDir(tmpDir));
});

test('writeJson creates file with pretty-printed JSON', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-writer-'));
  const filePath = path.join(tmpDir, 'data.json');
  writeJson(filePath, { key: 'value', count: 42 });

  const content = fs.readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(content);
  assert.equal(parsed.key, 'value');
  assert.equal(parsed.count, 42);
  // Pretty-printing produces indented output
  assert.ok(content.includes('\n'));
  assert.ok(content.includes('  '));
});

test('writeJson creates parent directories if missing', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-writer-'));
  const filePath = path.join(tmpDir, 'nested', 'out', 'data.json');
  writeJson(filePath, { test: true });
  assert.ok(fs.existsSync(filePath));
});

test('writeJson overwrites existing file', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-writer-'));
  const filePath = path.join(tmpDir, 'data.json');
  writeJson(filePath, { version: 1 });
  writeJson(filePath, { version: 2 });
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  assert.equal(parsed.version, 2);
});

test('writeText creates a file with exact content', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-writer-'));
  const filePath = path.join(tmpDir, 'notes.txt');
  writeText(filePath, 'Hello, world!');
  assert.equal(fs.readFileSync(filePath, 'utf-8'), 'Hello, world!');
});

test('writeText creates parent directories if missing', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-writer-'));
  const filePath = path.join(tmpDir, 'a', 'b', 'c.txt');
  writeText(filePath, 'content');
  assert.ok(fs.existsSync(filePath));
});

