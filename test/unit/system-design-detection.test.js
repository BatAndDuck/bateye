const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildRepoIndex } = require('../../dist/core/indexing/index');
const { detectArchitecturalUnits } = require('../../dist/features/system-design/application/system-design-service');

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
  assert.deepEqual(byName.get('worker').dependencyHints.sort(), ['postgres', 'redis']);
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
