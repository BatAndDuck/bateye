const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function selectionRun(filePaths, reasons = ['selected by recall-first retrieval']) {
  return {
    data: {
      filePaths,
      reasons,
      confidence: 0.9,
      gaps: [],
    },
  };
}

function fileSummaryRun(overrides = {}) {
  return {
    data: {
      summary: 'Architecturally relevant source file.',
      interfaces: [],
      integrations: [],
      dependencies: [],
      entities: [],
      submodules: [],
      capabilities: [],
      importance: 5,
      ...overrides,
    },
  };
}

function serviceSynthesisRun(overrides = {}) {
  return {
    data: {
      serviceId: 'sample-app',
      name: 'sample-app',
      kind: 'app',
      purpose: 'Sample feature app',
      responsibilities: ['Serve requests'],
      capabilities: ['Serve requests'],
      publicInterfaces: [],
      dependencies: [],
      integrations: [],
      entities: [],
      submodules: ['routes', 'handlers'],
      complexityScore: 4,
      risks: [],
      confidence: 0.8,
      evidence: {
        filePaths: ['src/index.ts'],
        reasons: ['entrypoint'],
      },
      discoverySources: ['fallback'],
      gaps: [],
      conflicts: [],
      ...overrides,
    },
  };
}

test('system-design command reaches the mocked runtime and writes artifacts', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'codeowl-system-design-int-'));
  fs.mkdirSync(path.join(repoPath, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repoPath, 'src', 'index.ts'), 'export function main() { return true; }\n');

  writeJson(path.join(repoPath, '.codeowl', 'config.json'), {
    model: 'anthropic/mock-model',
    apiKeyEnvVariable: 'CODE_OWL_LLM_MODEL_API_KEY',
    exclude: [],
  });

  const fixturePath = path.join(repoPath, 'mock-runtime.json');
  const logPath = path.join(repoPath, 'mock-runtime-log.json');
  writeJson(fixturePath, {
    runs: [
      fileSummaryRun({
        summary: 'Root application entrypoint.',
        capabilities: ['Serve requests'],
        importance: 8,
      }),
      serviceSynthesisRun(),
      {
        data: {
          architectureType: 'modular-monolith',
          score: 82,
          strengths: ['Clear separation'],
          weaknesses: ['Needs more docs'],
          globalSummary: 'Single app organized into modules.',
        },
      },
    ],
  });

  const result = spawnSync('node', ['dist/index.js', 'system-design', '--cwd', repoPath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CODE_OWL_LLM_MODEL_API_KEY: 'direct-test-key',
      CODEOWL_RUNTIME: 'mock',
      CODEOWL_MOCK_RUNTIME_FIXTURES: fixturePath,
      CODEOWL_MOCK_RUNTIME_LOG: logPath,
    },
    encoding: 'utf-8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const outDir = path.join(repoPath, '.codeowl', 'out', 'system-design');
  assert.ok(fs.existsSync(path.join(outDir, 'index.html')));
  assert.ok(fs.existsSync(path.join(outDir, 'graph.json')));
  assert.ok(fs.existsSync(path.join(outDir, 'summary.json')));
  assert.ok(fs.existsSync(path.join(outDir, 'inventory.json')));
  assert.ok(fs.existsSync(path.join(outDir, 'coverage.json')));
  assert.ok(fs.existsSync(path.join(outDir, 'architecture.json')));
  assert.ok(fs.existsSync(path.join(outDir, 'units', 'sample-app.json')));

  const summary = JSON.parse(fs.readFileSync(path.join(outDir, 'summary.json'), 'utf-8'));
  assert.equal(summary.architectureType, 'modular-monolith');
  assert.ok(summary.coverage);

  const log = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
  assert.ok(log.filter(entry => entry.type === 'run').length >= 3);
});

test('system-design expands analysis beyond seed files and preserves late controller evidence', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'codeowl-system-design-recall-'));
  fs.mkdirSync(path.join(repoPath, 'src', 'api', 'controllers'), { recursive: true });
  fs.writeFileSync(path.join(repoPath, 'src', 'api', 'package.json'), JSON.stringify({ name: 'api-service' }, null, 2));
  fs.writeFileSync(path.join(repoPath, 'src', 'api', 'index.ts'), 'export const api = true;\n');
  fs.writeFileSync(path.join(repoPath, 'orders-client.ts'), 'export const ordersClient = true;\n');
  for (let i = 0; i < 40; i += 1) {
    fs.writeFileSync(path.join(repoPath, 'src', 'api', `filler-${String(i).padStart(2, '0')}.ts`), `export const f${i} = ${i};\n`);
  }
  fs.writeFileSync(
    path.join(repoPath, 'src', 'api', 'controllers', 'zz-orders-controller.ts'),
    'export const ordersController = { get: () => "ok" };\n',
  );

  writeJson(path.join(repoPath, '.codeowl', 'config.json'), {
    model: 'anthropic/mock-model',
    apiKeyEnvVariable: 'CODE_OWL_LLM_MODEL_API_KEY',
    exclude: [],
  });

  const fixturePath = path.join(repoPath, 'mock-runtime.json');
  const logPath = path.join(repoPath, 'mock-runtime-log.json');
  writeJson(fixturePath, {
    runs: [
      selectionRun(['orders-client.ts']),
      selectionRun([], ['second retrieval pass found no additional files']),
      fileSummaryRun({
        summary: 'Package manifest for the API service.',
        importance: 7,
      }),
      fileSummaryRun({
        summary: 'HTTP controller for order requests.',
        interfaces: [{ type: 'http', name: 'GET /orders' }],
        capabilities: ['Handle order requests'],
        importance: 9,
      }),
      fileSummaryRun({
        summary: 'API entrypoint wiring routes and handlers.',
        interfaces: [{ type: 'http', name: 'GET /orders' }],
        submodules: ['routes', 'controllers'],
        importance: 8,
      }),
      fileSummaryRun({
        summary: 'Shared client used by the API service for order-specific coordination.',
        dependencies: ['orders-client'],
        importance: 6,
      }),
      serviceSynthesisRun({
        serviceId: 'api-service',
        name: 'api-service',
        kind: 'gateway',
        purpose: 'HTTP API gateway for orders.',
        responsibilities: ['Handle order requests'],
        capabilities: ['Handle order requests'],
        publicInterfaces: [{ type: 'http', name: 'GET /orders' }],
        evidence: {
          filePaths: ['src/api/package.json', 'src/api/index.ts', 'src/api/controllers/zz-orders-controller.ts', 'orders-client.ts'],
          reasons: ['summary pass'],
        },
      }),
      {
        data: {
          architectureType: 'hybrid-service-oriented',
          score: 78,
          strengths: ['Controller surface recovered from late file'],
          weaknesses: [],
          globalSummary: 'API service with controller-based routing.',
        },
      },
    ],
  });

  const result = spawnSync('node', ['dist/index.js', 'system-design', '--cwd', repoPath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CODE_OWL_LLM_MODEL_API_KEY: 'direct-test-key',
      CODEOWL_RUNTIME: 'mock',
      CODEOWL_MOCK_RUNTIME_FIXTURES: fixturePath,
      CODEOWL_MOCK_RUNTIME_LOG: logPath,
    },
    encoding: 'utf-8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const outDir = path.join(repoPath, '.codeowl', 'out', 'system-design');
  const inventory = JSON.parse(fs.readFileSync(path.join(outDir, 'inventory.json'), 'utf-8'));
  const unit = inventory.units.find(entry => entry.selectedFiles.includes('src/api/controllers/zz-orders-controller.ts'));
  assert.ok(unit);
  assert.ok(unit.selectedFiles.includes('src/api/controllers/zz-orders-controller.ts'));
  assert.ok(unit.selectedFiles.includes('orders-client.ts'));
  assert.ok(unit.selectedFiles.length > unit.seedFiles.length);

  const service = JSON.parse(fs.readFileSync(path.join(outDir, 'services', `${unit.unitId}.json`), 'utf-8'));
  assert.ok(service.publicInterfaces.some(iface => iface.name === 'GET /orders' || iface.name.includes('zz-orders-controller')));
});

test('system-design deduplicates shared integrations and keeps distinct instances separate', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'codeowl-system-design-integrations-'));
  fs.mkdirSync(path.join(repoPath, 'src', 'api'), { recursive: true });
  fs.writeFileSync(path.join(repoPath, 'src', 'api', 'package.json'), JSON.stringify({ name: 'api-service' }, null, 2));
  fs.writeFileSync(path.join(repoPath, 'src', 'api', 'db-primary.ts'), 'export const primary = true;\n');
  fs.writeFileSync(path.join(repoPath, 'src', 'api', 'db-primary-helper.ts'), 'export const primaryHelper = true;\n');
  fs.writeFileSync(path.join(repoPath, 'src', 'api', 'db-analytics.ts'), 'export const analytics = true;\n');

  writeJson(path.join(repoPath, '.codeowl', 'config.json'), {
    model: 'anthropic/mock-model',
    apiKeyEnvVariable: 'CODE_OWL_LLM_MODEL_API_KEY',
    exclude: [],
  });

  const fixturePath = path.join(repoPath, 'mock-runtime.json');
  writeJson(fixturePath, {
    runs: [
      fileSummaryRun({ summary: 'Package manifest.', importance: 6 }),
      fileSummaryRun({
        summary: 'Primary database client.',
        integrations: [{ name: 'postgres', description: 'Reads and writes application data.', internal: false, category: 'database', instanceKey: 'app-db' }],
        importance: 8,
      }),
      fileSummaryRun({
        summary: 'Helper around the primary database client.',
        integrations: [{ name: 'postgres', description: 'Reads and writes application data.', internal: false, category: 'database', instanceKey: 'app-db' }],
        importance: 7,
      }),
      fileSummaryRun({
        summary: 'Analytics database client.',
        integrations: [{ name: 'postgres', description: 'Queries analytics data.', internal: false, category: 'database', instanceKey: 'analytics-db' }],
        importance: 8,
      }),
      serviceSynthesisRun({
        serviceId: 'api-service',
        name: 'api-service',
        kind: 'gateway',
        capabilities: ['Serve API requests'],
        integrations: [
          { name: 'postgres', description: 'Reads and writes application data.', internal: false, category: 'database', instanceKey: 'app-db' },
          { name: 'postgres', description: 'Reads and writes application data.', internal: false, category: 'database', instanceKey: 'app-db' },
          { name: 'postgres', description: 'Queries analytics data.', internal: false, category: 'database', instanceKey: 'analytics-db' },
        ],
        evidence: {
          filePaths: ['src/api/db-primary.ts', 'src/api/db-primary-helper.ts', 'src/api/db-analytics.ts'],
          reasons: ['database summaries'],
        },
      }),
      {
        data: {
          architectureType: 'hybrid-service-oriented',
          score: 80,
          strengths: ['Integration instances resolved'],
          weaknesses: [],
          globalSummary: 'API service with two distinct Postgres instances.',
        },
      },
    ],
  });

  const result = spawnSync('node', ['dist/index.js', 'system-design', '--cwd', repoPath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CODE_OWL_LLM_MODEL_API_KEY: 'direct-test-key',
      CODEOWL_RUNTIME: 'mock',
      CODEOWL_MOCK_RUNTIME_FIXTURES: fixturePath,
    },
    encoding: 'utf-8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const outDir = path.join(repoPath, '.codeowl', 'out', 'system-design');
  const graph = JSON.parse(fs.readFileSync(path.join(outDir, 'graph.json'), 'utf-8'));
  const resourceNodes = graph.nodes.filter(node => node.kind === 'resource');
  assert.equal(resourceNodes.length, 2);
  assert.ok(resourceNodes.some(node => node.id === 'integration-postgres-appdb'));
  assert.ok(resourceNodes.some(node => node.id === 'integration-postgres-analyticsdb'));

  const service = JSON.parse(fs.readFileSync(path.join(outDir, 'services', 'api-service.json'), 'utf-8'));
  assert.equal(service.integrations.length, 2);
});

test('system-design links frontend URL calls to backend services from detected HTTP routes', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'codeowl-system-design-http-links-'));
  fs.mkdirSync(path.join(repoPath, 'frontend', 'src'), { recursive: true });
  fs.mkdirSync(path.join(repoPath, 'api'), { recursive: true });

  fs.writeFileSync(path.join(repoPath, 'frontend', 'package.json'), JSON.stringify({
    name: 'frontend-app',
    dependencies: {
      react: '^18.0.0',
      'react-dom': '^18.0.0',
    },
  }, null, 2));
  fs.writeFileSync(path.join(repoPath, 'frontend', 'src', 'users.service.ts'), `
import { HttpClient } from '@angular/common/http';
export class UsersService {
  private apiUrl = environment.apiUrl + 'users';
  constructor(private http: HttpClient) {}
  loadUsers() { return this.http.get(this.apiUrl); }
}
`);
  fs.writeFileSync(path.join(repoPath, 'api', 'UsersController.cs'), `
using Microsoft.AspNetCore.Mvc;
[Route("api/[controller]")]
public class UsersController : ControllerBase
{
  [HttpGet]
  public IActionResult Get() { return Ok(); }
}
`);

  const result = spawnSync('node', ['dist/index.js', 'system-design', '--cwd', repoPath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CODE_OWL_LLM_MODEL_API_KEY: '',
    },
    encoding: 'utf-8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const outDir = path.join(repoPath, '.codeowl', 'out', 'system-design');
  const frontend = JSON.parse(fs.readFileSync(path.join(outDir, 'services', 'frontend.json'), 'utf-8'));
  const api = JSON.parse(fs.readFileSync(path.join(outDir, 'services', 'api.json'), 'utf-8'));
  const graph = JSON.parse(fs.readFileSync(path.join(outDir, 'graph.json'), 'utf-8'));

  assert.ok(api.publicInterfaces.some(iface => iface.name === 'GET /api/users'));
  assert.ok(frontend.dependencies.includes('api'));
  assert.ok(graph.edges.some(edge => edge.source === 'frontend' && edge.target === 'api'));
});

test('system-design uses dependency-cruiser to expand files and infer cross-unit code dependencies', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'codeowl-system-design-depcruise-'));
  fs.mkdirSync(path.join(repoPath, 'frontend', 'src'), { recursive: true });
  fs.mkdirSync(path.join(repoPath, 'api', 'src'), { recursive: true });

  fs.writeFileSync(path.join(repoPath, 'frontend', 'package.json'), JSON.stringify({
    name: 'frontend',
    dependencies: {
      react: '^18.0.0',
      'react-dom': '^18.0.0',
    },
  }, null, 2));
  fs.writeFileSync(path.join(repoPath, 'api', 'package.json'), JSON.stringify({
    name: 'api',
    dependencies: {
      express: '^4.0.0',
    },
  }, null, 2));
  fs.writeFileSync(path.join(repoPath, 'frontend', 'src', 'index.ts'), `
import { createApiClient } from '../../api/src/client';
export const app = createApiClient();
`);
  fs.writeFileSync(path.join(repoPath, 'api', 'src', 'client.ts'), `
export function createApiClient() {
  return { baseUrl: '/api/users' };
}
`);

  const result = spawnSync('node', ['dist/index.js', 'system-design', '--cwd', repoPath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CODE_OWL_LLM_MODEL_API_KEY: '',
    },
    encoding: 'utf-8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const outDir = path.join(repoPath, '.codeowl', 'out', 'system-design');
  const inventory = JSON.parse(fs.readFileSync(path.join(outDir, 'inventory.json'), 'utf-8'));
  const frontendUnit = inventory.units.find(entry => entry.unitId === 'frontend');
  const frontend = JSON.parse(fs.readFileSync(path.join(outDir, 'services', 'frontend.json'), 'utf-8'));
  const frontendAnalysis = JSON.parse(fs.readFileSync(path.join(outDir, 'units', 'frontend.json'), 'utf-8'));
  const graph = JSON.parse(fs.readFileSync(path.join(outDir, 'graph.json'), 'utf-8'));

  assert.ok(frontendUnit.selectedFiles.includes('api/src/client.ts'));
  assert.ok(frontendAnalysis.selectionReasons.some(reason => reason.includes('Dependency-cruiser')));
  assert.ok(frontend.dependencies.includes('api'));
  assert.ok(graph.edges.some(edge => edge.source === 'frontend' && edge.target === 'api'));
});
