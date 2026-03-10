const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  ensureDir,
  writeJson,
  writeText,
  writeSystemDesignResult,
} = require('../../dist/core/output/writer');

test('ensureDir creates a new nested directory', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codeowl-writer-'));
  const target = path.join(tmpDir, 'new', 'nested', 'dir');
  ensureDir(target);
  assert.ok(fs.existsSync(target));
  assert.ok(fs.statSync(target).isDirectory());
});

test('ensureDir does not throw if directory already exists', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codeowl-writer-'));
  assert.doesNotThrow(() => ensureDir(tmpDir));
});

test('writeJson creates file with pretty-printed JSON', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codeowl-writer-'));
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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codeowl-writer-'));
  const filePath = path.join(tmpDir, 'nested', 'out', 'data.json');
  writeJson(filePath, { test: true });
  assert.ok(fs.existsSync(filePath));
});

test('writeJson overwrites existing file', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codeowl-writer-'));
  const filePath = path.join(tmpDir, 'data.json');
  writeJson(filePath, { version: 1 });
  writeJson(filePath, { version: 2 });
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  assert.equal(parsed.version, 2);
});

test('writeText creates a file with exact content', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codeowl-writer-'));
  const filePath = path.join(tmpDir, 'notes.txt');
  writeText(filePath, 'Hello, world!');
  assert.equal(fs.readFileSync(filePath, 'utf-8'), 'Hello, world!');
});

test('writeText creates parent directories if missing', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codeowl-writer-'));
  const filePath = path.join(tmpDir, 'a', 'b', 'c.txt');
  writeText(filePath, 'content');
  assert.ok(fs.existsSync(filePath));
});

test('writeSystemDesignResult creates services dir with JSON and Markdown per service', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codeowl-writer-'));
  const outputDir = path.join(tmpDir, 'output');

  const service = {
    serviceId: 'api-service',
    name: 'api-service',
    kind: 'service',
    purpose: 'Handles API requests',
    responsibilities: ['Route requests', 'Validate input'],
    capabilities: ['REST API', 'Rate limiting'],
    publicInterfaces: [{ type: 'http', name: 'GET /health', description: 'Health check' }],
    integrations: [{ name: 'postgres', description: 'Primary datastore', internal: false, category: 'database' }],
    dependencies: ['database'],
    entities: [{ name: 'User', description: 'User entity', fields: ['id', 'email'] }],
    submodules: ['routes', 'controllers'],
    complexityScore: 5,
    risks: [],
  };

  const result = {
    command: 'system-design',
    repoPath: '/some/repo',
    architectureType: 'monolith',
    score: 85,
    strengths: [],
    weaknesses: [],
    services: [service],
    globalSummary: 'A monolith',
    artifacts: { htmlReportPath: '', graphDataPath: '', servicesDir: '' },
    generatedAt: new Date().toISOString(),
  };

  writeSystemDesignResult(outputDir, result);

  const jsonPath = path.join(outputDir, 'services', 'api-service.json');
  const mdPath = path.join(outputDir, 'services', 'api-service.md');

  assert.ok(fs.existsSync(jsonPath), 'JSON file should exist');
  assert.ok(fs.existsSync(mdPath), 'Markdown file should exist');

  const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  assert.equal(parsed.serviceId, 'api-service');
  assert.equal(parsed.kind, 'service');

  const md = fs.readFileSync(mdPath, 'utf-8');
  assert.ok(md.includes('# api-service'));
  assert.ok(md.includes('Handles API requests'));
  assert.ok(md.includes('Route requests'));
  assert.ok(md.includes('GET /health'));
  assert.ok(md.includes('User'));
  assert.ok(md.includes('database'));
  assert.ok(md.includes('Rate limiting'));   // capabilities section
  assert.ok(md.includes('postgres'));        // integrations section
});

test('writeSystemDesignResult handles service with no interfaces or submodules', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codeowl-writer-'));
  const outputDir = path.join(tmpDir, 'output2');

  const service = {
    serviceId: 'lib',
    name: 'lib',
    kind: 'library',
    purpose: 'Shared utilities',
    responsibilities: [],
    capabilities: [],
    publicInterfaces: [],
    integrations: [],
    dependencies: [],
    entities: [],
    submodules: [],
    complexityScore: 2,
    risks: [],
  };

  const result = {
    command: 'system-design',
    repoPath: '/repo',
    architectureType: 'monolith',
    score: 70,
    strengths: [],
    weaknesses: [],
    services: [service],
    globalSummary: 'Simple lib',
    artifacts: { htmlReportPath: '', graphDataPath: '', servicesDir: '' },
    generatedAt: new Date().toISOString(),
  };

  writeSystemDesignResult(outputDir, result);

  const md = fs.readFileSync(path.join(outputDir, 'services', 'lib.md'), 'utf-8');
  assert.ok(md.includes('_None_'));
  assert.ok(md.includes('_None detected_'));
});

test('writeSystemDesignResult writes multiple services', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codeowl-writer-'));
  const outputDir = path.join(tmpDir, 'output3');

  const makeService = (id) => ({
    serviceId: id,
    name: id,
    kind: 'service',
    purpose: `${id} purpose`,
    responsibilities: [],
    capabilities: [],
    publicInterfaces: [],
    integrations: [],
    dependencies: [],
    entities: [],
    submodules: [],
    complexityScore: 3,
    risks: [],
  });

  const result = {
    command: 'system-design',
    repoPath: '/repo',
    architectureType: 'microservices',
    score: 80,
    strengths: [],
    weaknesses: [],
    services: [makeService('frontend'), makeService('backend')],
    globalSummary: 'Two services',
    artifacts: { htmlReportPath: '', graphDataPath: '', servicesDir: '' },
    generatedAt: new Date().toISOString(),
  };

  writeSystemDesignResult(outputDir, result);

  assert.ok(fs.existsSync(path.join(outputDir, 'services', 'frontend.json')));
  assert.ok(fs.existsSync(path.join(outputDir, 'services', 'backend.json')));
  assert.ok(fs.existsSync(path.join(outputDir, 'services', 'frontend.md')));
  assert.ok(fs.existsSync(path.join(outputDir, 'services', 'backend.md')));
});
