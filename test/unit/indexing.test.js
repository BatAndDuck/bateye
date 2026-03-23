const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  readFileContent,
  scopeFilesForReviewer,
  formatFilesForContext,
  buildRepoIndex,
  calculateAuditSeedFileBudget,
  selectAuditSeedFiles,
} = require('../../dist/core/indexing/index');

// Helpers
function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-idx-'));
}

function makeIndex(relPaths, baseDir) {
  return {
    files: relPaths.map(relPath => ({
      relativePath: relPath,
      absolutePath: path.join(baseDir || '/repo', relPath),
      sizeBytes: 100,
      extension: path.extname(relPath),
    })),
    repoPath: baseDir || '/repo',
    totalFiles: relPaths.length,
  };
}

// readFileContent
test('readFileContent reads file content correctly', () => {
  const tmpDir = makeTmpDir();
  const filePath = path.join(tmpDir, 'test.ts');
  fs.writeFileSync(filePath, 'export const x = 1;');
  assert.equal(readFileContent(filePath), 'export const x = 1;');
});

test('readFileContent returns empty string for non-existent file', () => {
  assert.equal(readFileContent('/tmp/bateye-definitely-does-not-exist.ts'), '');
});

test('readFileContent truncates content exceeding token limit', () => {
  const tmpDir = makeTmpDir();
  const filePath = path.join(tmpDir, 'large.ts');
  // 100 tokens * 4 chars = 400 char limit; write 1000 chars
  fs.writeFileSync(filePath, 'x'.repeat(1000));
  const result = readFileContent(filePath, 100);
  assert.ok(result.includes('[...file truncated...]'));
  assert.ok(result.length < 1000);
});

test('readFileContent returns full content when within token limit', () => {
  const tmpDir = makeTmpDir();
  const filePath = path.join(tmpDir, 'small.ts');
  const content = 'export const small = true;';
  fs.writeFileSync(filePath, content);
  const result = readFileContent(filePath, 8000);
  assert.equal(result, content);
  assert.ok(!result.includes('[...file truncated...]'));
});

// scopeFilesForReviewer
test('scopeFilesForReviewer returns all files when no hints or globs provided', () => {
  const index = makeIndex(['src/index.ts', 'src/utils.ts', 'test/foo.test.ts']);
  const result = scopeFilesForReviewer(index, undefined, undefined);
  assert.equal(result.length, 3);
});

test('scopeFilesForReviewer returns all files', () => {
  const index = makeIndex(['src/auth/login.ts', 'src/utils.ts', 'test/auth.test.ts']);
  const result = scopeFilesForReviewer(index);
  assert.equal(result.length, 3);
});

test('calculateAuditSeedFileBudget scales with repo size and reviewer type', () => {
  const smallIndex = makeIndex(Array.from({ length: 18 }, (_, i) => `src/file${i}.ts`));
  const largeIndex = makeIndex(Array.from({ length: 900 }, (_, i) => `src/file${i}.ts`));

  const smallBudget = calculateAuditSeedFileBudget(
    smallIndex,
    { category: 'qa' },
    smallIndex.files.slice(0, 12),
  );
  const largeBudget = calculateAuditSeedFileBudget(
    largeIndex,
    { category: 'qa' },
    largeIndex.files.slice(0, 250),
  );
  const toolBudget = calculateAuditSeedFileBudget(
    largeIndex,
    { category: 'qa', tool: { command: 'npm', args: ['test'] } },
    largeIndex.files.slice(0, 250),
  );

  assert.equal(smallBudget, 10);
  assert.equal(largeBudget, 30);
  assert.equal(toolBudget, 12);
});

test('selectAuditSeedFiles prioritizes relevant config and UI files for performance reviewers', () => {
  const index = makeIndex([
    'docs/guide.md',
    'package.json',
    'src/app.tsx',
    'src/components/button.tsx',
    'src/utils/math.ts',
    'test/app.test.tsx',
    'vite.config.ts',
  ]);

  const selected = selectAuditSeedFiles(
    index,
    { category: 'performance' },
    index.files,
  ).map(file => file.relativePath);

  // Config and UI files are included; scoring prioritizes them
  assert.ok(selected.includes('vite.config.ts'));
  assert.ok(selected.includes('src/components/button.tsx'));
  assert.ok(selected.includes('src/app.tsx'));
});

// formatFilesForContext
test('formatFilesForContext returns empty string for no files', () => {
  const result = formatFilesForContext([]);
  assert.equal(result, '');
});

test('formatFilesForContext includes file path headers', () => {
  const tmpDir = makeTmpDir();
  const srcDir = path.join(tmpDir, 'src');
  fs.mkdirSync(srcDir, { recursive: true });
  const filePath = path.join(srcDir, 'index.ts');
  fs.writeFileSync(filePath, 'export const x = 1;');

  const files = [{ relativePath: 'src/index.ts', absolutePath: filePath, sizeBytes: 20, extension: '.ts' }];
  const result = formatFilesForContext(files);
  assert.ok(result.includes('=== FILE: src/index.ts ==='));
  assert.ok(result.includes('export const x = 1;'));
});

test('formatFilesForContext limits output to maxFiles', () => {
  const tmpDir = makeTmpDir();
  const files = Array.from({ length: 5 }, (_, i) => {
    const filePath = path.join(tmpDir, `file${i}.ts`);
    fs.writeFileSync(filePath, `export const x${i} = ${i};`);
    return { relativePath: `file${i}.ts`, absolutePath: filePath, sizeBytes: 20, extension: '.ts' };
  });

  const result = formatFilesForContext(files, 3);
  const fileHeaders = (result.match(/=== FILE: /g) || []).length;
  assert.equal(fileHeaders, 3);
});

test('formatFilesForContext skips files with empty content', () => {
  const files = [
    { relativePath: 'missing.ts', absolutePath: '/tmp/bateye-does-not-exist/missing.ts', sizeBytes: 0, extension: '.ts' },
  ];
  const result = formatFilesForContext(files);
  assert.equal(result, '');
});

// Normalize path separators (glob may return backslashes on Windows)
function normRelPath(p) {
  return p.replace(/\\/g, '/');
}

// buildRepoIndex
test('buildRepoIndex indexes TypeScript and JavaScript files', async () => {
  const tmpDir = makeTmpDir();
  fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'src', 'app.ts'), 'export const app = true;');
  fs.writeFileSync(path.join(tmpDir, 'src', 'utils.js'), 'module.exports = {};');

  const index = await buildRepoIndex(tmpDir, { exclude: [] });
  assert.ok(index.totalFiles >= 2);
  assert.ok(index.files.some(f => normRelPath(f.relativePath) === 'src/app.ts'));
  assert.ok(index.files.some(f => normRelPath(f.relativePath) === 'src/utils.js'));
  assert.equal(index.repoPath, tmpDir);
});

test('buildRepoIndex excludes node_modules by default', async () => {
  const tmpDir = makeTmpDir();
  fs.mkdirSync(path.join(tmpDir, 'node_modules', 'some-pkg'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'node_modules', 'some-pkg', 'index.js'), 'module.exports = {};');
  fs.writeFileSync(path.join(tmpDir, 'index.ts'), 'export const x = 1;');

  const index = await buildRepoIndex(tmpDir, { exclude: [] });
  assert.ok(!index.files.some(f => normRelPath(f.relativePath).includes('node_modules')));
  assert.ok(index.files.some(f => normRelPath(f.relativePath) === 'index.ts'));
});

test('buildRepoIndex excludes custom patterns from config', async () => {
  const tmpDir = makeTmpDir();
  fs.mkdirSync(path.join(tmpDir, 'generated'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'generated', 'schema.ts'), 'export type Schema = {};');
  fs.writeFileSync(path.join(tmpDir, 'index.ts'), 'export const x = 1;');

  const index = await buildRepoIndex(tmpDir, { exclude: ['generated'] });
  assert.ok(!index.files.some(f => normRelPath(f.relativePath).startsWith('generated/')));
  assert.ok(index.files.some(f => normRelPath(f.relativePath) === 'index.ts'));
});

test('buildRepoIndex excludes built-in reviewer prompt directories during self-audit', async () => {
  const tmpDir = makeTmpDir();
  fs.mkdirSync(path.join(tmpDir, 'src', 'features', 'audit', 'builtin-reviewers'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'src', 'features', 'audit', 'builtin-reviewers', 'code-quality.md'), '# reviewer');
  fs.writeFileSync(path.join(tmpDir, 'index.ts'), 'export const x = 1;');

  const index = await buildRepoIndex(tmpDir, { exclude: [] });
  assert.ok(!index.files.some(f => normRelPath(f.relativePath).startsWith('src/features/audit/builtin-reviewers/')));
  assert.ok(index.files.some(f => normRelPath(f.relativePath) === 'index.ts'));
});

test('buildRepoIndex skips non-text extensions', async () => {
  const tmpDir = makeTmpDir();
  fs.writeFileSync(path.join(tmpDir, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(tmpDir, 'index.ts'), 'export const x = 1;');

  const index = await buildRepoIndex(tmpDir, { exclude: [] });
  assert.ok(!index.files.some(f => normRelPath(f.relativePath) === 'image.png'));
  assert.ok(index.files.some(f => normRelPath(f.relativePath) === 'index.ts'));
});
