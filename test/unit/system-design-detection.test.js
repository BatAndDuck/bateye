const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  detectArchitecturalUnits,
} = require('../../dist/features/system-design/application/system-design-service');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'codeowl-sysdesign-'));
}

function makeRepoFile(repoPath, relativePath) {
  return {
    relativePath,
    absolutePath: path.join(repoPath, relativePath),
    sizeBytes: 100,
    extension: path.extname(relativePath),
  };
}

function makeIndex(repoPath, relPaths) {
  return {
    files: relPaths.map(p => makeRepoFile(repoPath, p)),
    repoPath,
    totalFiles: relPaths.length,
  };
}

// Fallback behaviour
test('detectArchitecturalUnits falls back to src/ when no container dirs present', async () => {
  const tmpDir = makeTmpDir();
  fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'src', 'index.ts'), 'export const x = 1;');

  const index = makeIndex(tmpDir, ['src/index.ts']);
  const units = await detectArchitecturalUnits(tmpDir, index);

  assert.ok(units.length >= 1);
  const srcUnit = units.find(u => u.dirPath === 'src');
  assert.ok(srcUnit, 'Expected a unit with dirPath = src');
});

test('detectArchitecturalUnits falls back to repo root when src/ is empty', async () => {
  const tmpDir = makeTmpDir();
  fs.writeFileSync(path.join(tmpDir, 'README.md'), '# App');

  const index = makeIndex(tmpDir, ['README.md']);
  const units = await detectArchitecturalUnits(tmpDir, index);

  assert.equal(units.length, 1);
  assert.equal(units[0].dirPath, '.');
});

// Phase 1: container directories (packages, apps, services, etc.)
test('detectArchitecturalUnits detects subdirs inside packages/ as separate units', async () => {
  const tmpDir = makeTmpDir();
  fs.mkdirSync(path.join(tmpDir, 'packages', 'core'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'packages', 'ui'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'packages', 'core', 'index.ts'), 'export const x = 1;');
  fs.writeFileSync(path.join(tmpDir, 'packages', 'ui', 'App.tsx'), 'export default () => null;');

  const index = makeIndex(tmpDir, [
    'packages/core/index.ts',
    'packages/ui/App.tsx',
  ]);
  const units = await detectArchitecturalUnits(tmpDir, index);

  const names = units.map(u => u.name);
  assert.ok(names.includes('core'), 'Expected unit named "core"');
  assert.ok(names.includes('ui'), 'Expected unit named "ui"');
});

test('detectArchitecturalUnits detects subdirs inside apps/ as separate units', async () => {
  const tmpDir = makeTmpDir();
  fs.mkdirSync(path.join(tmpDir, 'apps', 'frontend'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'apps', 'backend'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'apps', 'frontend', 'main.tsx'), 'export default App;');
  fs.writeFileSync(path.join(tmpDir, 'apps', 'backend', 'server.ts'), 'export const server = {};');

  const index = makeIndex(tmpDir, [
    'apps/frontend/main.tsx',
    'apps/backend/server.ts',
  ]);
  const units = await detectArchitecturalUnits(tmpDir, index);

  const names = units.map(u => u.name);
  assert.ok(names.includes('frontend'), 'Expected unit named "frontend"');
  assert.ok(names.includes('backend'), 'Expected unit named "backend"');
});

// Phase 2: top-level service directories
test('detectArchitecturalUnits detects top-level frontend directory', async () => {
  const tmpDir = makeTmpDir();
  fs.mkdirSync(path.join(tmpDir, 'frontend'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'frontend', 'App.tsx'), 'export default App;');

  const index = makeIndex(tmpDir, ['frontend/App.tsx']);
  const units = await detectArchitecturalUnits(tmpDir, index);

  const frontendUnit = units.find(u => u.name === 'frontend');
  assert.ok(frontendUnit, 'Expected a unit named "frontend"');
  assert.equal(frontendUnit.kindHint, 'app');
});

test('detectArchitecturalUnits detects top-level api directory', async () => {
  const tmpDir = makeTmpDir();
  fs.mkdirSync(path.join(tmpDir, 'api'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'api', 'server.ts'), 'export const app = {};');

  const index = makeIndex(tmpDir, ['api/server.ts']);
  const units = await detectArchitecturalUnits(tmpDir, index);

  const apiUnit = units.find(u => u.name === 'api');
  assert.ok(apiUnit, 'Expected a unit named "api"');
});

// Phase 3: src/ subdirectories
test('detectArchitecturalUnits picks up multiple src/ subdirs', async () => {
  const tmpDir = makeTmpDir();
  fs.mkdirSync(path.join(tmpDir, 'src', 'auth'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'src', 'billing'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'src', 'auth', 'login.ts'), 'export const login = () => {};');
  fs.writeFileSync(path.join(tmpDir, 'src', 'billing', 'invoice.ts'), 'export const invoice = {};');

  const index = makeIndex(tmpDir, [
    'src/auth/login.ts',
    'src/billing/invoice.ts',
  ]);
  const units = await detectArchitecturalUnits(tmpDir, index);

  const names = units.map(u => u.name);
  assert.ok(names.includes('auth'), 'Expected unit named "auth"');
  assert.ok(names.includes('billing'), 'Expected unit named "billing"');
});

// Deduplication
test('detectArchitecturalUnits does not duplicate units with same name', async () => {
  const tmpDir = makeTmpDir();
  // Create both packages/frontend AND top-level frontend
  fs.mkdirSync(path.join(tmpDir, 'packages', 'frontend'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'frontend'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'packages', 'frontend', 'App.tsx'), 'export default App;');
  fs.writeFileSync(path.join(tmpDir, 'frontend', 'App.tsx'), 'export default App;');

  const index = makeIndex(tmpDir, [
    'packages/frontend/App.tsx',
    'frontend/App.tsx',
  ]);
  const units = await detectArchitecturalUnits(tmpDir, index);

  const frontendUnits = units.filter(u => u.name === 'frontend');
  assert.equal(frontendUnits.length, 1, 'Should not duplicate "frontend" unit');
});

// Kind inference
test('detectArchitecturalUnits assigns worker kind to worker directories', async () => {
  const tmpDir = makeTmpDir();
  fs.mkdirSync(path.join(tmpDir, 'workers'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'workers', 'email.ts'), 'export const emailWorker = {};');

  const index = makeIndex(tmpDir, ['workers/email.ts']);
  const units = await detectArchitecturalUnits(tmpDir, index);

  const workersUnit = units.find(u => u.name === 'workers');
  assert.ok(workersUnit, 'Expected a unit named "workers"');
  assert.equal(workersUnit.kindHint, 'worker');
});

test('detectArchitecturalUnits assigns library kind to lib directories', async () => {
  const tmpDir = makeTmpDir();
  fs.mkdirSync(path.join(tmpDir, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'lib', 'utils.ts'), 'export const util = () => {};');

  const index = makeIndex(tmpDir, ['lib/utils.ts']);
  const units = await detectArchitecturalUnits(tmpDir, index);

  const libUnit = units.find(u => u.name === 'lib');
  assert.ok(libUnit, 'Expected a unit named "lib"');
  assert.equal(libUnit.kindHint, 'library');
});
