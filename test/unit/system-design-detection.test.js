const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildRepoIndex } = require('../../dist/core/indexing/index');
const { detectArchitecturalUnits } = require('../../dist/features/system-design/application/system-design-service');

// ── Helpers for fast synthetic-index tests ──────────────────────────────────

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

// ── Fallback behaviour ───────────────────────────────────────────────────────

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

// ── Phase 1: container directories (apps/, services/, modules/, etc.) ────────

test('detectArchitecturalUnits detects subdirs inside services/ as separate units', async () => {
  const tmpDir = makeTmpDir();
  fs.mkdirSync(path.join(tmpDir, 'services', 'core'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'services', 'gateway'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'services', 'core', 'index.ts'), 'export const x = 1;');
  fs.writeFileSync(path.join(tmpDir, 'services', 'gateway', 'index.ts'), 'export const gw = {};');

  const index = makeIndex(tmpDir, [
    'services/core/index.ts',
    'services/gateway/index.ts',
  ]);
  const units = await detectArchitecturalUnits(tmpDir, index);

  const names = units.map(u => u.name);
  assert.ok(names.includes('core'), 'Expected unit named "core"');
  assert.ok(names.includes('gateway'), 'Expected unit named "gateway"');
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

// ── Phase 2: top-level service directories ────────────────────────────────────

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

// ── Phase 3: src/ subdirectories ─────────────────────────────────────────────

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

// ── Deduplication ─────────────────────────────────────────────────────────────

test('detectArchitecturalUnits does not duplicate units with same name', async () => {
  const tmpDir = makeTmpDir();
  // Phase 1 detects services/frontend; Phase 2 would also detect top-level frontend/
  fs.mkdirSync(path.join(tmpDir, 'services', 'frontend'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'frontend'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'services', 'frontend', 'App.tsx'), 'export default App;');
  fs.writeFileSync(path.join(tmpDir, 'frontend', 'App.tsx'), 'export default App;');

  const index = makeIndex(tmpDir, [
    'services/frontend/App.tsx',
    'frontend/App.tsx',
  ]);
  const units = await detectArchitecturalUnits(tmpDir, index);

  const frontendUnits = units.filter(u => u.name === 'frontend');
  assert.equal(frontendUnits.length, 1, 'Should not duplicate "frontend" unit');
});

// ── Kind inference ────────────────────────────────────────────────────────────

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

// ── Compose-based detection (from main) ───────────────────────────────────────

test('detectArchitecturalUnits includes compose services and infrastructure resources', async () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'codeowl-system-design-detect-'));

  fs.mkdirSync(path.join(repoPath, 'apps', 'frontend'), { recursive: true });
  fs.mkdirSync(path.join(repoPath, 'services', 'api'), { recursive: true });
  fs.mkdirSync(path.join(repoPath, 'workers', 'sync'), { recursive: true });

  fs.writeFileSync(path.join(repoPath, 'apps', 'frontend', 'index.tsx'), 'export const Frontend = () => null;\n');
  fs.writeFileSync(path.join(repoPath, 'services', 'api', 'index.ts'), 'export function api() { return true; }\n');
  fs.writeFileSync(path.join(repoPath, 'workers', 'sync', 'index.ts'), 'export async function run() { return true; }\n');
  fs.writeFileSync(path.join(repoPath, 'docker-compose.yml'), `
services:
  frontend:
    build: ./apps/frontend
  api:
    build: ./services/api
    depends_on:
      - redis
      - postgres
  worker:
    build: ./workers/sync
    depends_on:
      - redis
  redis:
    image: redis:7
  postgres:
    image: postgres:16
`);

  const index = await buildRepoIndex(repoPath, { exclude: [] });
  const units = await detectArchitecturalUnits(repoPath, index);

  const byName = new Map(units.map(unit => [unit.name, unit]));

  assert.ok(byName.has('frontend'));
  assert.ok(byName.has('api'));
  assert.ok(byName.has('worker'));
  assert.ok(byName.has('redis'));
  assert.ok(byName.has('postgres'));

  assert.equal(byName.get('redis').kindHint, 'resource');
  assert.equal(byName.get('postgres').kindHint, 'resource');
  assert.deepEqual(byName.get('api').dependencyHints.sort(), ['postgres', 'redis']);
  assert.deepEqual(byName.get('worker').dependencyHints.sort(), ['redis']);
});

test('detectArchitecturalUnits splits a hybrid Next.js app into frontend and bff and infers resources', async () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'codeowl-system-design-next-'));

  fs.mkdirSync(path.join(repoPath, 'apps', 'web-host', 'app', 'api', 'chat'), { recursive: true });
  fs.mkdirSync(path.join(repoPath, 'apps', 'web-host', 'src', 'components'), { recursive: true });

  fs.writeFileSync(path.join(repoPath, 'apps', 'web-host', 'package.json'), JSON.stringify({
    name: 'web-host',
    dependencies: {
      next: '^16.0.0',
      '@clerk/nextjs': '^6.0.0',
      openai: '^5.0.0',
    },
  }, null, 2));
  fs.writeFileSync(path.join(repoPath, 'apps', 'web-host', 'app', 'page.tsx'), 'export default function Page() { return <div>Hello</div>; }\n');
  fs.writeFileSync(path.join(repoPath, 'apps', 'web-host', 'app', 'api', 'chat', 'route.ts'), `
import { auth } from '@clerk/nextjs';
import OpenAI from 'openai';
export async function POST() { auth(); return new Response('ok'); }
`);
  fs.writeFileSync(path.join(repoPath, 'apps', 'web-host', 'src', 'components', 'Shell.tsx'), 'export function Shell() { return null; }\n');

  const index = await buildRepoIndex(repoPath, { exclude: [] });
  const units = await detectArchitecturalUnits(repoPath, index);

  const byName = new Map(units.map(unit => [unit.name, unit]));
  const frontendUnit = units.find(unit => /frontend/i.test(unit.name));
  const bffUnit = units.find(unit => /\bbff\b/i.test(unit.name));

  assert.ok(frontendUnit);
  assert.ok(bffUnit);
  assert.ok(byName.has('clerk'));
  assert.ok(byName.has('llm'));

  assert.equal(frontendUnit.kindHint, 'app');
  assert.equal(bffUnit.kindHint, 'gateway');
  assert.ok(bffUnit.interfaceHints.some(api => api.type === 'http' && api.name === '/chat'));
  assert.ok(bffUnit.dependencyHints.includes('clerk'));
  assert.ok(bffUnit.dependencyHints.includes('llm'));
});

test('detectArchitecturalUnits keeps a single-package CLI as one app and ignores prompt-only infra mentions', async () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'codeowl-system-design-cli-'));

  fs.mkdirSync(path.join(repoPath, 'src', 'cli'), { recursive: true });
  fs.mkdirSync(path.join(repoPath, 'src', 'commands'), { recursive: true });
  fs.mkdirSync(path.join(repoPath, 'src', 'core', 'prompts'), { recursive: true });

  fs.writeFileSync(path.join(repoPath, 'package.json'), JSON.stringify({
    name: 'codeowl',
    bin: { codeowl: 'dist/index.js' },
    dependencies: {
      commander: '^12.0.0',
      openai: '^5.0.0',
    },
  }, null, 2));
  fs.writeFileSync(path.join(repoPath, 'src', 'cli', 'index.ts'), `
import { Command } from 'commander';
import OpenAI from 'openai';
export function createCli() { return new Command().name('codeowl'); }
export function createLlm() { return new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); }
`);
  fs.writeFileSync(path.join(repoPath, 'src', 'commands', 'audit.ts'), 'export function audit() { return "ok"; }\n');
  fs.writeFileSync(path.join(repoPath, 'src', 'core', 'prompts', 'system-design.ts'), `
export const prompt = "Mention redis postgres clerk vector-search stripe only as examples.";
`);

  const index = await buildRepoIndex(repoPath, { exclude: [] });
  const units = await detectArchitecturalUnits(repoPath, index);

  const unitNames = units.map(unit => unit.name.toLowerCase());
  const rootUnit = units.find(unit => unit.dirPath === '.');

  assert.ok(rootUnit);
  assert.equal(rootUnit.kindHint, 'app');
  assert.ok(!unitNames.includes('commands'));
  assert.ok(!unitNames.includes('core'));
  assert.ok(!unitNames.includes('schemas'));
  assert.ok(unitNames.includes('llm'));
  assert.ok(!unitNames.includes('redis'));
  assert.ok(!unitNames.includes('postgres'));
  assert.ok(!unitNames.includes('clerk'));
  assert.ok(!unitNames.includes('vector-search'));
  assert.ok(!unitNames.includes('stripe'));
});

test('detectArchitecturalUnits attributes resources through local workspace imports for split app units', async () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'codeowl-system-design-workspace-'));

  fs.mkdirSync(path.join(repoPath, 'apps', 'web-host', 'app', 'api', 'chat'), { recursive: true });
  fs.mkdirSync(path.join(repoPath, 'apps', 'web-host', 'app', '(marketing)'), { recursive: true });
  fs.mkdirSync(path.join(repoPath, 'packages', 'libs', 'llm', 'src'), { recursive: true });

  fs.writeFileSync(path.join(repoPath, 'apps', 'web-host', 'package.json'), JSON.stringify({
    name: 'web-host',
    dependencies: {
      next: '^16.0.0',
      '@clerk/nextjs': '^6.0.0',
      '@libs/llm': '*',
    },
  }, null, 2));
  fs.writeFileSync(path.join(repoPath, 'apps', 'web-host', 'app', 'page.tsx'), `
import { SignedIn } from '@clerk/nextjs';
export default function Page() { return <SignedIn />; }
`);
  fs.writeFileSync(path.join(repoPath, 'apps', 'web-host', 'app', 'api', 'chat', 'route.ts'), `
import { summarize } from '@libs/llm';
export async function POST() { return Response.json(await summarize()); }
`);
  fs.writeFileSync(path.join(repoPath, 'packages', 'libs', 'llm', 'package.json'), JSON.stringify({
    name: '@libs/llm',
    dependencies: {
      openai: '^5.0.0',
    },
  }, null, 2));
  fs.writeFileSync(path.join(repoPath, 'packages', 'libs', 'llm', 'src', 'index.ts'), `
import OpenAI from 'openai';
export async function summarize() { return new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); }
`);

  const index = await buildRepoIndex(repoPath, { exclude: [] });
  const units = await detectArchitecturalUnits(repoPath, index);
  const frontendUnit = units.find(unit => /frontend/i.test(unit.name));
  const bffUnit = units.find(unit => /\bbff\b/i.test(unit.name));

  assert.ok(frontendUnit);
  assert.ok(bffUnit);
  assert.ok(frontendUnit.dependencyHints.includes('clerk'));
  assert.ok(!frontendUnit.dependencyHints.includes('llm'));
  assert.ok(bffUnit.dependencyHints.includes('llm'));
});

test('detectArchitecturalUnits does not leak transitive backend resources into a split frontend unit', async () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'codeowl-system-design-frontend-boundary-'));

  fs.mkdirSync(path.join(repoPath, 'apps', 'web-host', 'app', 'api', 'chat'), { recursive: true });
  fs.mkdirSync(path.join(repoPath, 'packages', 'shared', 'contracts', 'src'), { recursive: true });
  fs.mkdirSync(path.join(repoPath, 'packages', 'libs', 'llm', 'src'), { recursive: true });

  fs.writeFileSync(path.join(repoPath, 'apps', 'web-host', 'package.json'), JSON.stringify({
    name: 'web-host',
    dependencies: {
      next: '^16.0.0',
      '@clerk/nextjs': '^6.0.0',
      '@shared/contracts': '*',
      '@libs/llm': '*',
    },
  }, null, 2));
  fs.writeFileSync(path.join(repoPath, 'apps', 'web-host', 'app', 'page.tsx'), `
import type { SummaryCard } from '@shared/contracts';
import { SignedIn } from '@clerk/nextjs';
export default function Page() { const card = {} as SummaryCard; return <SignedIn>{card.title}</SignedIn>; }
`);
  fs.writeFileSync(path.join(repoPath, 'apps', 'web-host', 'app', 'api', 'chat', 'route.ts'), `
import { summarize } from '@libs/llm';
export async function POST() { return Response.json(await summarize()); }
`);
  fs.writeFileSync(path.join(repoPath, 'packages', 'shared', 'contracts', 'package.json'), JSON.stringify({
    name: '@shared/contracts',
    dependencies: {
      openai: '^5.0.0',
    },
  }, null, 2));
  fs.writeFileSync(path.join(repoPath, 'packages', 'shared', 'contracts', 'src', 'index.ts'), `
export type SummaryCard = { title: string };
`);
  fs.writeFileSync(path.join(repoPath, 'packages', 'libs', 'llm', 'package.json'), JSON.stringify({
    name: '@libs/llm',
    dependencies: {
      openai: '^5.0.0',
    },
  }, null, 2));
  fs.writeFileSync(path.join(repoPath, 'packages', 'libs', 'llm', 'src', 'index.ts'), `
import OpenAI from 'openai';
export async function summarize() { return new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); }
`);

  const index = await buildRepoIndex(repoPath, { exclude: [] });
  const units = await detectArchitecturalUnits(repoPath, index);
  const frontendUnit = units.find(unit => /frontend/i.test(unit.name));
  const bffUnit = units.find(unit => /\bbff\b/i.test(unit.name));

  assert.ok(frontendUnit);
  assert.ok(bffUnit);
  assert.ok(frontendUnit.dependencyHints.includes('clerk'));
  assert.ok(!frontendUnit.dependencyHints.includes('llm'));
  assert.ok(bffUnit.dependencyHints.includes('llm'));
});
