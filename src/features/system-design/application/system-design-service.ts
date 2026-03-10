import * as fs from 'fs';
import * as path from 'path';
import { RepoFile, RepoIndex, ResourceCategory, ServiceDesignDoc, ServiceInterfaceType, ServiceKind, SystemDesignResult } from '../../../types/index';
import { buildRepoIndex, formatFilesForContext } from '../../../core/indexing/index';
import { createRuntime, getRuntime } from '../../../core/runtime/factory';
import { serviceDesignDocSchema, ServiceDoc } from '../../../core/validation/schemas';
import { buildServiceAnalysisSystemPrompt, buildServiceAnalysisUserMessage } from '../../../core/prompts/system-design';
import { synthesizeArchitecture } from '../../../core/system-design/synthesizer';
import { buildGraph } from '../../../core/system-design/graph';
import { ensureDir, writeJson, writeSystemDesignResult, writeText } from '../../../core/output/writer';
import { SYSTEM_DESIGN_OUTPUT_DIR } from '../../../core/config/defaults';
import { listTopLevelDirs } from '../../../core/git/index';
import { IRuntime } from '../../../core/runtime/interface';
import { resolveApiKey, resolveConfig } from '../../config/application/config-service';

const SYSTEM_DESIGN_TEMPLATE_CANDIDATES = [
  path.resolve(__dirname, '../assets/index.html'),
  path.resolve(__dirname, '../../../../src/features/system-design/assets/index.html'),
];

const CONTAINER_DIRS = ['apps', 'services', 'modules', 'infra', 'infrastructure', 'deploy', 'deployment', 'docker', 'compose'];
const TOP_LEVEL_SERVICE_DIRS = [
  'frontend', 'web', 'client', 'ui', 'mobile', 'admin', 'dashboard',
  'backend', 'api', 'server', 'bff',
  'worker', 'workers', 'jobs', 'job', 'queue', 'queues', 'scheduler', 'cron',
  'gateway', 'proxy',
  'database', 'db', 'data',
  'redis', 'cache', 'postgres', 'postgresql', 'mysql', 'mariadb', 'mongo', 'mongodb',
  'kafka', 'rabbitmq', 'nats', 'sqs',
  'search', 'elasticsearch', 'opensearch',
  'storage', 'blob', 'files',
  'shared', 'common', 'lib', 'libs',
];
const COMMON_SERVICE_PREFIXES = ['apps', 'services', 'packages', 'modules', 'src', 'src/apps', 'src/services', 'src/modules'];
const RESOURCE_NAME_PATTERN = /(redis|cache|postgres|postgresql|mysql|mariadb|mongo|mongodb|database|db|kafka|rabbitmq|nats|sqs|sns|elastic|opensearch|storage|minio|s3|bucket|queue|broker)/i;
const SUBMODULE_SEGMENTS = new Set([
  'api', 'app', 'application', 'components', 'commands', 'queries', 'controllers', 'services', 'repositories',
  'domain', 'entities', 'models', 'schemas', 'db', 'data', 'workers', 'jobs', 'lib', 'server', 'client',
  'routes', 'handlers', 'adapters', 'providers', 'features',
]);
const ENTITY_STOP_WORDS = new Set(['Props', 'State', 'Config', 'Options', 'Response', 'Request', 'Params']);
const INTERFACE_LIKE_SUBMODULES = new Set(['health', 'status', 'download', 'upload', 'docs', 'webhooks']);
const GENERIC_APP_NAMES = new Set(['web', 'web-host', 'frontend', 'client', 'app', 'site', 'portal', 'ui']);

type IntegrationResource = {
  name: string;
  description: string;
  category: ResourceCategory;
  packages: string[];
  codePatterns: RegExp[];
};

const INTEGRATION_RESOURCES: IntegrationResource[] = [
  { name: 'clerk', description: 'Authentication and user management provider', category: 'external-saas', packages: ['@clerk/nextjs', '@clerk/backend', '@clerk/clerk-sdk-node', '@clerk/express'], codePatterns: [/^\s*import\s+.*['"]@clerk\//m, /^\s*(?:const|let|var)\s+.*=\s*require\(['"]@clerk\//m] },
  { name: 'llm', description: 'LLM provider or orchestration layer', category: 'external-api', packages: ['openai', '@anthropic-ai/sdk', 'anthropic', 'langchain', '@langchain/openai', '@google/generative-ai', 'ollama'], codePatterns: [/^\s*import\s+.*['"]openai['"]/m, /^\s*import\s+.*['"]@anthropic-ai\/sdk['"]/m, /^\s*import\s+.*['"]langchain/m, /\bnew\s+OpenAI\s*\(/, /\bnew\s+Anthropic\s*\(/] },
  { name: 'dynamodb', description: 'AWS DynamoDB datastore', category: 'database', packages: ['@aws-sdk/client-dynamodb'], codePatterns: [/^\s*import\s+.*['"]@aws-sdk\/client-dynamodb['"]/m, /\bnew\s+DynamoDBClient\s*\(/] },
  { name: 's3', description: 'AWS S3 object storage', category: 'storage', packages: ['@aws-sdk/client-s3'], codePatterns: [/^\s*import\s+.*['"]@aws-sdk\/client-s3['"]/m, /\bnew\s+S3Client\s*\(/] },
  { name: 'vector-search', description: 'Vector search or embeddings index', category: 'vector-search', packages: ['@pinecone-database/pinecone', 'pinecone', '@qdrant/js-client-rest', 'weaviate-client', '@weaviate/weaviate-ts-client'], codePatterns: [/^\s*import\s+.*pinecone/m, /^\s*import\s+.*qdrant/m, /^\s*import\s+.*weaviate/m, /\bnew\s+Pinecone\s*\(/, /\bnew\s+QdrantClient\s*\(/, /\bweaviateClient\s*\(/] },
  { name: 'redis', description: 'Redis cache or broker', category: 'cache', packages: ['redis', 'ioredis'], codePatterns: [/^\s*import\s+.*['"]redis['"]/m, /^\s*import\s+.*['"]ioredis['"]/m, /\bnew\s+Redis\s*\(/] },
  { name: 'postgres', description: 'PostgreSQL relational datastore', category: 'database', packages: ['pg', 'postgres', '@prisma/client', 'drizzle-orm'], codePatterns: [/^\s*import\s+.*['"]pg['"]/m, /^\s*import\s+.*['"]postgres['"]/m, /^\s*import\s+.*['"]@prisma\/client['"]/m, /^\s*import\s+.*['"]drizzle-orm['"]/m, /\bnew\s+PrismaClient\s*\(/, /postgres:\/\//i] },
  { name: 'stripe', description: 'Payments platform', category: 'external-saas', packages: ['stripe'], codePatterns: [/^\s*import\s+.*['"]stripe['"]/m, /\bnew\s+Stripe\s*\(/] },
];

export interface SystemDesignOptions {
  repoPath: string;
  outputDir?: string;
  onProgress?: (msg: string) => void;
}

export interface SystemDesignDependencies {
  getRuntime: () => Promise<IRuntime>;
}

const defaultDependencies: SystemDesignDependencies = {
  getRuntime,
};

export async function runSystemDesign(
  options: SystemDesignOptions,
  dependencies: SystemDesignDependencies = defaultDependencies,
): Promise<SystemDesignResult> {
  const { repoPath, onProgress } = options;
  const log = (msg: string) => onProgress?.(msg);
  const outputDir = options.outputDir || path.join(repoPath, SYSTEM_DESIGN_OUTPUT_DIR);

  log('Loading configuration...');
  const config = resolveConfig(repoPath);
  let apiKey: string | null = null;
  try {
    apiKey = resolveApiKey(config);
  } catch (err) {
    log(`API key unavailable, continuing with static architecture analysis: ${(err as Error).message}`);
  }

  log('Indexing repository...');
  const index = await buildRepoIndex(repoPath, config);
  log(`Found ${index.totalFiles} files.`);

  log('Detecting services and modules...');
  const units = await detectArchitecturalUnits(repoPath, index);
  log(`Detected ${units.length} architectural unit(s): ${units.map(unit => unit.name).join(', ')}`);

  const runtime = apiKey ? await resolveSystemDesignRuntime(dependencies, log) : null;
  const services: ServiceDesignDoc[] = [];

  for (const unit of units) {
    log(`Analyzing: ${unit.name}...`);
    const serviceDoc = await analyzeUnit(unit, config.model, apiKey, runtime, log);
    services.push(serviceDoc);
    log(`  ✓ ${unit.name}: ${serviceDoc.kind}`);
  }

  const topLevelDirs = await listTopLevelDirs(repoPath);
  const repoStructure = `Top-level directories: ${topLevelDirs.join(', ')}\nTotal files: ${index.totalFiles}`;

  log('Synthesizing architecture...');
  const synthesis = apiKey
    ? await synthesizeArchitecture(services, repoStructure, config.model, apiKey)
    : synthesizeStaticArchitecture(services, repoStructure);
  const generatedAt = new Date().toISOString();

  const result: SystemDesignResult = {
    command: 'system-design',
    repoPath: path.resolve(repoPath),
    architectureType: synthesis.architectureType,
    score: synthesis.score,
    strengths: synthesis.strengths,
    weaknesses: synthesis.weaknesses,
    services,
    globalSummary: synthesis.globalSummary,
    artifacts: {
      htmlReportPath: path.join(outputDir, 'index.html'),
      graphDataPath: path.join(outputDir, 'graph.json'),
      servicesDir: path.join(outputDir, 'services'),
    },
    generatedAt,
  };

  log('Writing output files...');
  ensureDir(outputDir);
  writeSystemDesignResult(outputDir, result);

  const graph = buildGraph(result);
  writeJson(path.join(outputDir, 'graph.json'), graph);
  writeJson(path.join(outputDir, 'summary.json'), {
    architectureType: result.architectureType,
    score: result.score,
    strengths: result.strengths,
    weaknesses: result.weaknesses,
    globalSummary: result.globalSummary,
    serviceCount: services.length,
    generatedAt,
  });

  generateHTMLReport(outputDir, graph);
  log(`✓ HTML report: ${path.join(outputDir, 'index.html')}`);

  return result;
}

interface ArchitecturalUnit {
  name: string;
  dirPath: string;
  files: RepoFile[];
  kindHint?: ServiceKind;
  resourceCategory?: ResourceCategory;
  dependencyHints: string[];
  analysisHints: string[];
  capabilityHints: string[];
  integrationHints: ServiceDesignDoc['integrations'];
  submoduleHints: string[];
  entityHints: {
    name: string;
    description?: string;
    fields?: string[];
  }[];
  interfaceHints: {
    type: ServiceInterfaceType;
    name: string;
    description?: string;
  }[];
  purposeHint?: string;
}

interface WorkspacePackageInfo {
  name: string;
  dirPath: string;
  files: RepoFile[];
  manifestDependencies: Set<string>;
  importedPackages: Set<string>;
}

interface WorkspaceContext {
  packagesByName: Map<string, WorkspacePackageInfo>;
}

export async function detectArchitecturalUnits(
  repoPath: string,
  index: RepoIndex,
): Promise<ArchitecturalUnit[]> {
  const units: ArchitecturalUnit[] = [];
  const usedDirPaths = new Set<string>();
  const usedNames = new Set<string>();

  const addUnit = (
    name: string,
    dirPath: string,
    files: RepoFile[],
    options: Partial<Pick<ArchitecturalUnit, 'kindHint' | 'resourceCategory' | 'dependencyHints' | 'analysisHints' | 'capabilityHints' | 'integrationHints' | 'submoduleHints' | 'entityHints' | 'interfaceHints' | 'purposeHint'>> = {},
  ) => {
    const normalizedPath = normalizePath(dirPath);
    const normalizedName = name.trim().toLowerCase();
    const hasNestedCoverage = units.some(unit =>
      unit.dirPath === normalizedPath
      || unit.dirPath.startsWith(normalizedPath + '/')
      || unit.dirPath.startsWith(normalizedPath + '#')
    );

    if (files.length > 0 && !usedDirPaths.has(normalizedPath) && !usedNames.has(normalizedName) && !hasNestedCoverage) {
      units.push({
        name,
        dirPath: normalizedPath,
        files,
        kindHint: options.kindHint,
        resourceCategory: options.resourceCategory,
        dependencyHints: [...new Set(options.dependencyHints || [])],
        analysisHints: [...new Set(options.analysisHints || [])],
        capabilityHints: dedupeStrings(options.capabilityHints || []),
        integrationHints: dedupeIntegrations(options.integrationHints || []),
        submoduleHints: dedupeStrings(options.submoduleHints || []),
        entityHints: dedupeEntities(options.entityHints || []),
        interfaceHints: dedupeInterfaces(options.interfaceHints || []),
        purposeHint: options.purposeHint,
      });
      usedDirPaths.add(normalizedPath);
      usedNames.add(normalizedName);
    }
  };

  // Phase 0: Infrastructure resources and services declared in compose files.
  for (const composeUnit of detectComposeUnits(repoPath, index)) {
    addUnit(composeUnit.name, composeUnit.dirPath, composeUnit.files, composeUnit);
  }

  // Phase 1: Package/workspace units. This is the primary monorepo detection path.
  for (const packageUnit of detectPackageUnits(repoPath, index)) {
    addUnit(packageUnit.name, packageUnit.dirPath, packageUnit.files, packageUnit);
  }

  const hasRootApplicationBoundary = units.some(unit => unit.dirPath === '.' || unit.dirPath.startsWith('.#'));

  // Phase 2: Multi-service container directories.
  for (const pattern of CONTAINER_DIRS) {
    const patternDir = path.join(repoPath, pattern);
    if (!fs.existsSync(patternDir)) continue;
    const subdirs = fs.readdirSync(patternDir)
      .filter(e => fs.statSync(path.join(patternDir, e)).isDirectory());
    for (const subdir of subdirs) {
      const dirPath = `${pattern}/${subdir}`;
      const files = index.files.filter(f => f.relativePath.startsWith(dirPath + '/'));
      addUnit(subdir, dirPath, files, {
        kindHint: inferServiceKind(subdir, dirPath),
        analysisHints: [`Detected from directory: ${dirPath}`],
      });
    }
  }

  // Phase 3: Common top-level service/resource directories.
  for (const dirName of TOP_LEVEL_SERVICE_DIRS) {
    const fullPath = path.join(repoPath, dirName);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) continue;
    const files = index.files.filter(f => f.relativePath.startsWith(dirName + '/'));
    addUnit(dirName, dirName, files, {
      kindHint: inferServiceKind(dirName, dirName),
      analysisHints: [`Detected from top-level directory: ${dirName}`],
    });
  }

  // Phase 4: Look under src/ and common containers inside src/.
  for (const parentDir of ['src', 'src/apps', 'src/services', 'src/modules']) {
    if (parentDir === 'src' && hasRootApplicationBoundary) continue;
    const fullPath = path.join(repoPath, parentDir);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) continue;
    const subdirs = fs.readdirSync(fullPath)
      .filter(entry => fs.statSync(path.join(fullPath, entry)).isDirectory());

    for (const subdir of subdirs) {
      const dirPath = `${parentDir}/${subdir}`;
      const files = index.files.filter(f => f.relativePath.startsWith(dirPath + '/'));
      if (files.length === 0) continue;

      const shouldInclude = subdirs.length > 1 || isServiceLikeDir(subdir) || RESOURCE_NAME_PATTERN.test(subdir);
      if (!shouldInclude) continue;

      addUnit(subdir, dirPath, files, {
        kindHint: inferServiceKind(subdir, dirPath),
        analysisHints: [`Detected from source directory: ${dirPath}`],
      });
    }
  }

  // Fallback: entire src/ or root as a single unit
  if (units.length === 0) {
    const srcFiles = index.files.filter(f => f.relativePath.startsWith('src/'));
    units.push(srcFiles.length > 0
      ? {
        name: path.basename(repoPath),
        dirPath: 'src',
        files: srcFiles,
        kindHint: 'app',
        dependencyHints: [],
        analysisHints: ['Fallback to src/ as a single architectural unit'],
        capabilityHints: [],
        integrationHints: [],
        submoduleHints: [],
        entityHints: [],
        interfaceHints: [],
      }
      : {
        name: path.basename(repoPath),
        dirPath: '.',
        files: index.files,
        kindHint: 'app',
        dependencyHints: [],
        analysisHints: ['Fallback to repository root as a single architectural unit'],
        capabilityHints: [],
        integrationHints: [],
        submoduleHints: [],
        entityHints: [],
        interfaceHints: [],
      });
  }

  return enrichArchitecturalUnits(index, units);
}

async function analyzeUnit(
  unit: ArchitecturalUnit,
  model: string,
  apiKey: string | null,
  runtime: IRuntime | null,
  log: (msg: string) => void,
): Promise<ServiceDesignDoc> {
  if (!apiKey || !runtime) {
    return buildStaticServiceDoc(unit);
  }

  const selectedFiles = selectFilesForAnalysis(unit);
  const filesContext = formatFilesForContext(selectedFiles, selectedFiles.length, 5000);
  const systemPrompt = buildServiceAnalysisSystemPrompt();
  const analysisHints = [...unit.analysisHints];
  if (unit.kindHint) analysisHints.push(`Suggested kind: ${unit.kindHint}`);
  if (unit.dependencyHints.length > 0) analysisHints.push(`Known integrations: ${unit.dependencyHints.join(', ')}`);
  if (unit.submoduleHints.length > 0) analysisHints.push(`Likely submodules: ${unit.submoduleHints.join(', ')}`);
  if (unit.entityHints.length > 0) analysisHints.push(`Likely data models: ${unit.entityHints.map(entity => entity.name).join(', ')}`);
  if (unit.interfaceHints.length > 0) analysisHints.push(`Likely public interfaces: ${unit.interfaceHints.map(api => `${api.type}:${api.name}`).join(', ')}`);
  const userMessage = buildServiceAnalysisUserMessage(unit.name, filesContext, analysisHints);

  try {
    const result = await runtime.run<ServiceDoc>(
      { systemPrompt, userMessage, model, apiKey, maxTokens: 4096 },
      serviceDesignDocSchema,
    );
    const doc = result.data as ServiceDesignDoc;
    if (unit.kindHint === 'resource' && doc.kind === 'service') {
      doc.kind = 'resource';
    }
    if (unit.resourceCategory && !doc.resourceCategory) {
      doc.resourceCategory = unit.resourceCategory;
    }
    if (unit.dependencyHints.length > 0) {
      doc.dependencies = [...new Set([...doc.dependencies, ...unit.dependencyHints])];
    }
    doc.responsibilities = dedupeStrings([...(doc.responsibilities || []), ...buildResponsibilities(unit)]).slice(0, 6);
    doc.capabilities = dedupeStrings([...unit.capabilityHints, ...(doc.capabilities || [])]).slice(0, 12);
    doc.integrations = dedupeIntegrations([...unit.integrationHints, ...(doc.integrations || [])]);
    if (doc.submodules.length === 0 && unit.submoduleHints.length > 0) {
      doc.submodules = unit.submoduleHints;
    }
    if (doc.entities.length === 0 && unit.entityHints.length > 0) {
      doc.entities = unit.entityHints;
    }
    if (doc.publicInterfaces.length === 0 && unit.interfaceHints.length > 0) {
      doc.publicInterfaces = unit.interfaceHints;
    }
    if (!doc.purpose || /service\/module detected from/i.test(doc.purpose)) {
      doc.purpose = buildFallbackPurpose(unit);
    }
    return doc;
  } catch (err) {
    log(`  Warning: Analysis failed for ${unit.name}: ${(err as Error).message}`);
    return {
      serviceId: unit.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      name: unit.name,
      kind: unit.kindHint || 'module',
      resourceCategory: unit.resourceCategory,
      purpose: buildFallbackPurpose(unit),
      responsibilities: buildResponsibilities(unit),
      capabilities: unit.capabilityHints,
      publicInterfaces: unit.interfaceHints,
      integrations: unit.integrationHints,
      dependencies: unit.dependencyHints,
      entities: unit.entityHints,
      submodules: unit.submoduleHints,
      complexityScore: estimateComplexity(unit.files, unit.kindHint),
      risks: [],
    };
  }
}

function buildStaticServiceDoc(unit: ArchitecturalUnit): ServiceDesignDoc {
  return {
    serviceId: unit.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name: unit.name,
    kind: unit.kindHint || 'module',
    resourceCategory: unit.resourceCategory,
    purpose: buildFallbackPurpose(unit),
    responsibilities: buildResponsibilities(unit),
    capabilities: unit.capabilityHints,
    publicInterfaces: unit.interfaceHints,
    integrations: unit.integrationHints,
    dependencies: unit.dependencyHints,
    entities: unit.entityHints,
    submodules: unit.submoduleHints,
    complexityScore: estimateComplexity(unit.files, unit.kindHint),
    risks: [],
  };
}

async function resolveSystemDesignRuntime(
  dependencies: SystemDesignDependencies,
  log: (msg: string) => void,
): Promise<IRuntime> {
  if (dependencies === defaultDependencies) {
    try {
      const runtime = await createRuntime('opencode-cli');
      log('Using OpenCode CLI runtime for deeper system-design research.');
      return runtime;
    } catch (err) {
      log(`OpenCode CLI unavailable, falling back to direct runtime: ${(err as Error).message}`);
    }
  }

  return dependencies.getRuntime();
}

function buildResponsibilities(unit: ArchitecturalUnit): string[] {
  const responsibilities: string[] = [];
  const featureSummary = summarizeFeatureHints(unit.submoduleHints);
  const integrationSummary = summarizeDependencies(unit.dependencyHints);

  if (unit.kindHint === 'app') {
    responsibilities.push(featureSummary
      ? `Deliver user-facing flows for ${featureSummary}`
      : 'Render user-facing screens and client flows');
  }
  if (unit.kindHint === 'gateway') {
    responsibilities.push('Handle API orchestration and server-side request flows');
    if (unit.interfaceHints.length > 0) {
      responsibilities.push(`Expose ${unit.interfaceHints.length} HTTP/API interface(s)`);
    }
  }
  if (unit.kindHint === 'worker') responsibilities.push('Run asynchronous or scheduled processing');
  if (unit.kindHint === 'resource') responsibilities.push('Provide infrastructure capability to other services');
  if (integrationSummary) responsibilities.push(`Integrate with ${integrationSummary}`);
  if (unit.entityHints.length > 0) responsibilities.push(`Own or manipulate data models such as ${unit.entityHints.slice(0, 3).map(entity => entity.name).join(', ')}`);
  return dedupeStrings(responsibilities);
}

function summarizeFeatureHints(submodules: string[]): string {
  let cleaned = submodules
    .map(normalizeSubmoduleLabel)
    .filter(Boolean);

  if (cleaned.length > 1) {
    cleaned = cleaned.filter(label => !['App', 'API'].includes(label));
  }

  return cleaned.slice(0, 3).join(', ');
}

function summarizeDependencies(dependencies: string[]): string {
  if (dependencies.length === 0) return '';
  return dependencies.slice(0, 4).map(humanizeName).join(', ');
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
}

function isServiceLikeDir(dirName: string): boolean {
  const normalized = dirName.toLowerCase();
  return TOP_LEVEL_SERVICE_DIRS.includes(normalized)
    || /(frontend|backend|api|worker|service|module|gateway|proxy|redis|cache|db|database)/.test(normalized);
}

function inferServiceKind(name: string, context = ''): ServiceKind {
  const haystack = `${name} ${context}`.toLowerCase();
  if (/(^|[\s/_-])(frontend|web|client|ui|mobile|admin|dashboard)(?=$|[\s/_-])/.test(haystack)) return 'app';
  if (/(^|[\s/_-])(worker|workers|job|jobs|scheduler|cron|consumer|queue)(?=$|[\s/_-])/.test(haystack)) return 'worker';
  if (/(^|[\s/_-])(gateway|proxy|bff|edge)(?=$|[\s/_-])/.test(haystack)) return 'gateway';
  if (/(^|[\s/_-])(shared|common|lib|libs|util|utils)(?=$|[\s/_-])/.test(haystack)) return 'library';
  if (RESOURCE_NAME_PATTERN.test(haystack)) return 'resource';
  if (/(^|[\s/_-])(module|feature|domain)(?=$|[\s/_-])/.test(haystack)) return 'module';
  return 'service';
}

function buildFallbackPurpose(unit: ArchitecturalUnit): string {
  if (unit.purposeHint) {
    return unit.purposeHint;
  }
  if (unit.kindHint === 'resource') {
    const resource = INTEGRATION_RESOURCES.find(candidate => candidate.name === unit.name.toLowerCase());
    return resource
      ? `${unit.name} resource: ${resource.description}.`
      : `${unit.name} infrastructure resource used by the system.`;
  }
  if (/\bbff\b/i.test(unit.name) || unit.kindHint === 'gateway') {
    return `${unit.name} handles backend-for-frontend and API orchestration responsibilities.`;
  }
  if (unit.kindHint === 'app') {
    return `${unit.name} is a user-facing application boundary.`;
  }
  if (unit.kindHint === 'worker') {
    return `${unit.name} runs asynchronous or background processing workflows.`;
  }
  return `${unit.name} service/module detected from ${unit.dirPath}.`;
}

function estimateComplexity(files: RepoFile[], kindHint?: ServiceKind): number {
  const fileCount = files.length;
  const configFiles = files.filter(file => /\.(json|ya?ml|toml|env|md|sql)$/i.test(file.relativePath)).length;
  const codeFiles = Math.max(0, fileCount - configFiles);
  let score = 2;

  if (codeFiles >= 6) score += 2;
  if (codeFiles >= 16) score += 2;
  if (codeFiles >= 32) score += 2;
  if (kindHint === 'worker' || kindHint === 'gateway') score += 1;
  if (kindHint === 'resource') score = Math.min(score, 4);

  return Math.max(1, Math.min(10, score));
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function dedupeEntities(values: ArchitecturalUnit['entityHints']): ArchitecturalUnit['entityHints'] {
  const seen = new Set<string>();
  const result: ArchitecturalUnit['entityHints'] = [];
  for (const entity of values) {
    const key = entity.name.toLowerCase();
    if (!entity.name || seen.has(key)) continue;
    seen.add(key);
    result.push(entity);
  }
  return result;
}

function dedupeInterfaces(values: ArchitecturalUnit['interfaceHints']): ArchitecturalUnit['interfaceHints'] {
  const seen = new Set<string>();
  const result: ArchitecturalUnit['interfaceHints'] = [];
  for (const api of values) {
    const key = `${api.type}:${api.name}`.toLowerCase();
    if (!api.name || seen.has(key)) continue;
    seen.add(key);
    result.push(api);
  }
  return result;
}

function dedupeIntegrations(values: ArchitecturalUnit['integrationHints']): ArchitecturalUnit['integrationHints'] {
  const seen = new Set<string>();
  const result: ArchitecturalUnit['integrationHints'] = [];
  for (const integration of values) {
    const key = `${integration.name.toLowerCase()}:${integration.internal}:${integration.category || ''}`;
    if (!integration.name || seen.has(key)) continue;
    seen.add(key);
    result.push({
      ...integration,
      description: integration.description.slice(0, 200),
    });
  }
  return result;
}

function detectPackageUnits(repoPath: string, index: RepoIndex): ArchitecturalUnit[] {
  const packageFiles = index.files.filter(file =>
    file.relativePath === 'package.json' || file.relativePath.endsWith('/package.json')
  );
  const units: ArchitecturalUnit[] = [];
  const hasNestedPackages = packageFiles.some(file => file.relativePath !== 'package.json');

  for (const packageFile of packageFiles) {
    const dirPath = packageFile.relativePath === 'package.json'
      ? '.'
      : normalizePath(path.posix.dirname(packageFile.relativePath));
    if (/(^|\/)(e2e|test|tests|spec|specs)(\/|$)/.test(dirPath)) continue;
    if (dirPath.startsWith('packages/')) continue;
    const manifest = readJson(packageFile.absolutePath);
    if (dirPath === '.' && shouldSkipRootPackageManifest(manifest, hasNestedPackages)) continue;
    const files = dirPath === '.'
      ? index.files
      : index.files.filter(file => file.relativePath.startsWith(dirPath + '/'));
    if (files.length === 0) continue;

    const solutionLabel = deriveSolutionLabel(repoPath, dirPath, manifest);
    if (manifest && isHybridWebAppPackage(manifest, files, dirPath)) {
      units.push(...splitHybridWebAppUnit(dirPath, files, solutionLabel));
      continue;
    }

    const unitName = dirPath === '.'
      ? deriveRootApplicationName(repoPath, manifest, files)
      : path.posix.basename(dirPath);
    units.push({
        name: unitName,
        dirPath,
        files: dirPath === '.'
          ? files.filter(isArchitectureRelevantFile)
          : files,
        kindHint: dirPath === '.'
          ? inferRootPackageKind(repoPath, manifest, files)
          : inferPackageKind(unitName, dirPath, manifest),
        resourceCategory: undefined,
        dependencyHints: [],
        analysisHints: [`Detected from package workspace: ${dirPath}`],
        capabilityHints: [],
        integrationHints: [],
        submoduleHints: [],
        entityHints: [],
        interfaceHints: [],
        purposeHint: dirPath === '.'
          ? inferRootPackagePurpose(repoPath, manifest, files)
          : inferPackagePurpose(unitName, dirPath, manifest),
    });
  }

  return units;
}

function readJson(filePath: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function shouldSkipRootPackageManifest(
  manifest: Record<string, unknown> | undefined,
  hasNestedPackages: boolean,
): boolean {
  if (!manifest) return hasNestedPackages;
  if (!hasNestedPackages) return false;
  if (isCliLikeManifest(manifest)) return false;
  if (hasDependency(manifest, 'next')) return false;
  return hasWorkspaceConfig(manifest);
}

function deriveRootApplicationName(
  repoPath: string,
  manifest: Record<string, unknown> | undefined,
  files: RepoFile[],
): string {
  const solutionLabel = deriveSolutionLabel(repoPath, '.', manifest);
  return isCliLikeManifest(manifest, files) && !/\bcli\b/i.test(solutionLabel)
    ? `${solutionLabel} CLI`
    : solutionLabel;
}

function inferRootPackageKind(
  repoPath: string,
  manifest: Record<string, unknown> | undefined,
  files: RepoFile[],
): ServiceKind {
  const solutionLabel = deriveSolutionLabel(repoPath, '.', manifest);
  if (isCliLikeManifest(manifest, files)) return 'app';
  return inferPackageKind(solutionLabel, '.', manifest);
}

function inferRootPackagePurpose(
  repoPath: string,
  manifest: Record<string, unknown> | undefined,
  files: RepoFile[],
): string | undefined {
  const solutionLabel = deriveRootApplicationName(repoPath, manifest, files);
  if (isCliLikeManifest(manifest, files)) {
    return `${solutionLabel} is the main command-line application for the repository.`;
  }
  return inferPackagePurpose(solutionLabel, '.', manifest);
}

function isCliLikeManifest(
  manifest: Record<string, unknown> | undefined,
  files: RepoFile[] = [],
): boolean {
  if (!manifest) return false;
  const hasBin = typeof manifest.bin === 'string'
    || (typeof manifest.bin === 'object' && manifest.bin !== null && Object.keys(manifest.bin as Record<string, unknown>).length > 0);
  return hasBin
    || hasDependency(manifest, 'commander')
    || files.some(file => /^src\/(cli|commands)\//.test(file.relativePath));
}

function hasWorkspaceConfig(manifest: Record<string, unknown>): boolean {
  return Array.isArray(manifest.workspaces)
    || (typeof manifest.workspaces === 'object' && manifest.workspaces !== null);
}

function hasDependency(manifest: Record<string, unknown>, packageName: string): boolean {
  return collectManifestDependencies(manifest).has(packageName.toLowerCase());
}

function collectManifestDependencies(manifest: Record<string, unknown> | undefined): Set<string> {
  const names = new Set<string>();
  if (!manifest) return names;

  for (const key of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const section = manifest[key];
    if (!section || typeof section !== 'object') continue;
    for (const name of Object.keys(section as Record<string, unknown>)) {
      names.add(name.toLowerCase());
    }
  }

  return names;
}

function inferPackageKind(name: string, dirPath: string, manifest?: Record<string, unknown>): ServiceKind {
  const dependencies = JSON.stringify(manifest?.dependencies || {});
  const devDependencies = JSON.stringify(manifest?.devDependencies || {});
  const haystack = `${name} ${dirPath} ${dependencies} ${devDependencies}`;
  if (/\"next\"/.test(haystack)) return 'app';
  return inferServiceKind(name, haystack);
}

function inferPackagePurpose(name: string, dirPath: string, manifest?: Record<string, unknown>): string | undefined {
  const manifestName = typeof manifest?.name === 'string' ? manifest.name : name;
  const kind = inferPackageKind(name, dirPath, manifest);
  if (kind === 'app') return `${manifestName} is an application package.`;
  if (kind === 'library') return `${manifestName} provides shared library capabilities.`;
  if (kind === 'worker') return `${manifestName} provides background processing or job execution.`;
  return undefined;
}

function deriveSolutionLabel(repoPath: string, dirPath: string, manifest?: Record<string, unknown>): string {
  const folderName = dirPath === '.' ? '' : path.posix.basename(dirPath);
  const manifestName = typeof manifest?.name === 'string'
    ? manifest.name.replace(/^@[^/]+\//, '')
    : '';
  const repoName = path.basename(repoPath);

  const candidate = [folderName, manifestName]
    .map(value => value.toLowerCase())
    .find(value => value && !GENERIC_APP_NAMES.has(value))
    || repoName;

  return humanizeName(candidate);
}

function humanizeName(value: string): string {
  const humanized = value
    .replace(/^@[^/]+\//, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, char => char.toUpperCase());

  return humanized
    .replace(/\bApi\b/g, 'API')
    .replace(/\bBff\b/g, 'BFF')
    .replace(/\bLlm\b/g, 'LLM')
    .replace(/\bS3\b/g, 'S3')
    .replace(/\bDynamodb\b/g, 'DynamoDB');
}

function isHybridWebAppPackage(
  manifest: Record<string, unknown>,
  files: RepoFile[],
  dirPath: string,
): boolean {
  const dependencies = JSON.stringify(manifest.dependencies || {});
  const hasNext = /\"next\"/.test(dependencies) || files.some(file => file.relativePath.startsWith(`${dirPath}/app/`) || file.relativePath.startsWith(`${dirPath}/src/app/`));
  if (!hasNext) return false;

  const apiFiles = files.filter(file => isApiLikeFile(file.relativePath, dirPath));
  const uiFiles = files.filter(file => isFrontendLikeFile(file.relativePath, dirPath));
  return apiFiles.length > 0 && uiFiles.length > 0;
}

function splitHybridWebAppUnit(dirPath: string, files: RepoFile[], solutionLabel: string): ArchitecturalUnit[] {
  const frontendName = `${solutionLabel} Frontend`;
  const bffName = `BFF for ${solutionLabel}`;

  const sharedFiles = files.filter(file =>
    file.relativePath === `${dirPath}/package.json`
    || file.relativePath === `${dirPath}/next.config.ts`
    || file.relativePath === `${dirPath}/next.config.js`
  );
  const serverSharedFiles = files.filter(file =>
    file.relativePath === `${dirPath}/middleware.ts`
    || file.relativePath === `${dirPath}/instrumentation.ts`
  );
  const frontendFiles = mergeFileLists(
    sharedFiles,
    files.filter(file => isFrontendLikeFile(file.relativePath, dirPath)),
  );
  const bffFiles = mergeFileLists(
    sharedFiles,
    serverSharedFiles,
    files.filter(file => isApiLikeFile(file.relativePath, dirPath)),
  );

  return [
    {
      name: frontendName,
      dirPath: `${dirPath}#frontend`,
      files: frontendFiles,
      kindHint: 'app',
      resourceCategory: undefined,
      dependencyHints: [bffName],
      analysisHints: [`Split from hybrid web app package: ${dirPath}`, 'Focus on user-facing UI, pages, components, and client-side flows'],
      capabilityHints: [],
      integrationHints: [{
        name: bffName,
        description: `Calls ${bffName} endpoints to load or mutate application data.`.slice(0, 200),
        internal: true,
      }],
      submoduleHints: [],
      entityHints: [],
      interfaceHints: [],
      purposeHint: `${frontendName} is the user-facing web application for ${solutionLabel}.`,
    },
    {
      name: bffName,
      dirPath: `${dirPath}#bff`,
      files: bffFiles,
      kindHint: 'gateway',
      resourceCategory: undefined,
      dependencyHints: [],
      analysisHints: [`Split from hybrid web app package: ${dirPath}`, 'Focus on API routes, server-side orchestration, middleware, and backend-for-frontend behavior'],
      capabilityHints: [],
      integrationHints: [],
      submoduleHints: [],
      entityHints: [],
      interfaceHints: inferHttpInterfaces(bffFiles, dirPath),
      purposeHint: `${bffName} handles API routes, middleware, and backend orchestration for ${solutionLabel}.`,
    },
  ];
}

function mergeFileLists(...groups: RepoFile[][]): RepoFile[] {
  const files = new Map<string, RepoFile>();
  for (const group of groups) {
    for (const file of group) {
      files.set(file.relativePath, file);
    }
  }
  return [...files.values()];
}

function isApiLikeFile(relativePath: string, rootDir: string): boolean {
  const relative = stripUnitPrefix(relativePath, rootDir);
  return /(^|\/)(app|src\/app|pages|src\/pages)\/api\//.test(relative)
    || /(^|\/)(server|src\/server)\//.test(relative)
    || /(^|\/)(middleware|instrumentation)\.(ts|tsx|js|jsx)$/.test(relative)
    || /(^|\/)(api|routes?)\//.test(relative);
}

function isFrontendLikeFile(relativePath: string, rootDir: string): boolean {
  const relative = stripUnitPrefix(relativePath, rootDir);
  if (isApiLikeFile(relativePath, rootDir)) return false;

  return /(^|\/)(app|src\/app|pages|src\/pages)\//.test(relative)
    || /(^|\/)(components|src\/components|public|assets)\//.test(relative)
    || /(^|\/)(layout|page|globals|HomePageClient)\./.test(path.posix.basename(relative));
}

function stripUnitPrefix(relativePath: string, dirPath: string): string {
  const physicalRoot = normalizePath(dirPath.split('#')[0]);
  if (physicalRoot === '.' || !physicalRoot) return relativePath;
  return relativePath.startsWith(`${physicalRoot}/`)
    ? relativePath.slice(physicalRoot.length + 1)
    : relativePath;
}

function isArchitectureRelevantFile(file: RepoFile): boolean {
  const relativePath = normalizePath(file.relativePath);
  return !/(^|\/)(test|tests|spec|specs|__tests__|fixtures?|e2e)(\/|$)/.test(relativePath)
    && !/^\.(codeowl|claude)(\/|$)/.test(relativePath);
}

function enrichArchitecturalUnits(index: RepoIndex, units: ArchitecturalUnit[]): ArchitecturalUnit[] {
  const workspaceContext = buildWorkspaceContext(index);
  const enriched = units.map(unit => {
    const signals = collectStaticSignals(unit, workspaceContext);
    return {
      ...unit,
      dependencyHints: dedupeStrings([...unit.dependencyHints, ...signals.integrations]),
      analysisHints: dedupeStrings([
        ...unit.analysisHints,
        ...(signals.integrations.length > 0 ? [`Static integrations detected: ${signals.integrations.join(', ')}`] : []),
      ]),
      capabilityHints: dedupeStrings([...unit.capabilityHints, ...signals.capabilities]),
      integrationHints: dedupeIntegrations([...unit.integrationHints, ...signals.integrationDetails]),
      submoduleHints: dedupeStrings([...unit.submoduleHints, ...signals.submodules]),
      entityHints: dedupeEntities([...unit.entityHints, ...signals.entities]),
      interfaceHints: dedupeInterfaces([...unit.interfaceHints, ...signals.interfaces]),
      purposeHint: unit.purposeHint || signals.purposeHint,
    };
  });

  const existingNames = new Set(enriched.map(unit => unit.name.toLowerCase()));
  const inferredResources: ArchitecturalUnit[] = [];

  for (const resource of INTEGRATION_RESOURCES) {
    if (existingNames.has(resource.name)) continue;
    const matchedFiles = index.files
      .filter(isArchitectureRelevantFile)
      .filter(file => fileContainsResourceEvidence(file, resource))
      .slice(0, 20);
    if (matchedFiles.length === 0) continue;

    inferredResources.push({
      name: resource.name,
      dirPath: `inferred-resource/${resource.name}`,
      files: matchedFiles,
      kindHint: 'resource',
      resourceCategory: resource.category,
      dependencyHints: [],
      analysisHints: [`Inferred resource from code/package usage`, `Resource description: ${resource.description}`],
      capabilityHints: [humanizeName(resource.description)],
      integrationHints: [],
      submoduleHints: [],
      entityHints: [],
      interfaceHints: [],
      purposeHint: `${resource.name} resource: ${resource.description}.`,
    });
    existingNames.add(resource.name);
  }

  return [...enriched, ...inferredResources];
}

function collectStaticSignals(unit: ArchitecturalUnit, workspaceContext: WorkspaceContext): {
  integrations: string[];
  capabilities: string[];
  integrationDetails: ArchitecturalUnit['integrationHints'];
  submodules: string[];
  entities: ArchitecturalUnit['entityHints'];
  interfaces: ArchitecturalUnit['interfaceHints'];
  purposeHint?: string;
} {
  const relevantFiles = unit.files.filter(isArchitectureRelevantFile);
  const integrations = detectUnitIntegrations(unit, relevantFiles, workspaceContext);

  const staticUnit = { ...unit, files: relevantFiles };
  const submodules = detectSubmoduleHints(staticUnit);
  const entities = detectEntityHints(relevantFiles);
  const interfaces = inferHttpInterfaces(relevantFiles, unit.dirPath);
  const capabilities = detectCapabilityHints(staticUnit, interfaces, submodules);
  const integrationDetails = buildIntegrationHints(unit, integrations);
  const purposeHint = inferStaticPurpose({ ...unit, files: relevantFiles, submoduleHints: dedupeStrings([...unit.submoduleHints, ...submodules]) }, integrations, interfaces);

  return { integrations, capabilities, integrationDetails, submodules, entities, interfaces, purposeHint };
}

function buildWorkspaceContext(index: RepoIndex): WorkspaceContext {
  const packagesByName = new Map<string, WorkspacePackageInfo>();
  const packageFiles = index.files.filter(file => /(^|\/)package\.json$/.test(file.relativePath));

  for (const packageFile of packageFiles) {
    const manifest = readJson(packageFile.absolutePath);
    if (!manifest || typeof manifest.name !== 'string') continue;

    const dirPath = packageFile.relativePath === 'package.json'
      ? '.'
      : normalizePath(path.posix.dirname(packageFile.relativePath));
    const files = (dirPath === '.'
      ? index.files
      : index.files.filter(file => file.relativePath.startsWith(dirPath + '/')))
      .filter(isArchitectureRelevantFile);

    packagesByName.set(manifest.name, {
      name: manifest.name,
      dirPath,
      files,
      manifestDependencies: collectManifestDependencies(manifest),
      importedPackages: collectImportedPackages(files),
    });
  }

  return { packagesByName };
}

function detectUnitIntegrations(
  unit: ArchitecturalUnit,
  relevantFiles: RepoFile[],
  workspaceContext: WorkspaceContext,
): string[] {
  const integrations = new Set<string>();
  const importedPackages = collectImportedPackages(relevantFiles);
  const useManifestDependencies = !unit.dirPath.includes('#');
  const allowWorkspaceResourcePropagation = shouldPropagateWorkspaceResources(unit, relevantFiles);

  for (const resource of INTEGRATION_RESOURCES) {
    if (relevantFiles.some(file => fileContainsResourceCodeEvidence(file, resource))) {
      integrations.add(resource.name);
      continue;
    }

    if (useManifestDependencies && relevantFiles.some(file => fileContainsResourcePackageEvidence(file, resource))) {
      integrations.add(resource.name);
    }
  }

  for (const importedPackage of importedPackages) {
    const directResource = inferResourceFromPackageName(importedPackage);
    if (directResource) {
      integrations.add(directResource);
      continue;
    }

    if (!allowWorkspaceResourcePropagation) continue;

    for (const resource of collectWorkspacePackageResources(importedPackage, workspaceContext)) {
      integrations.add(resource);
    }
  }

  return [...integrations];
}

function shouldPropagateWorkspaceResources(unit: ArchitecturalUnit, relevantFiles: RepoFile[]): boolean {
  if (unit.kindHint === 'resource') return false;
  if (unit.kindHint === 'gateway' || unit.kindHint === 'service' || unit.kindHint === 'worker') return true;
  if (unit.dirPath.endsWith('#bff')) return true;
  if (unit.dirPath.endsWith('#frontend')) return false;
  if (unit.kindHint !== 'app') return true;

  return relevantFiles.some(file => {
    if (isApiLikeFile(file.relativePath, unit.dirPath)) return true;
    const relative = stripUnitPrefix(file.relativePath, unit.dirPath).toLowerCase();
    return /(^|\/)(server|src\/server|actions|src\/actions)\//.test(relative)
      || /(^|\/)(middleware|instrumentation)\.(ts|tsx|js|jsx)$/.test(relative);
  });
}

function collectWorkspacePackageResources(
  packageName: string,
  workspaceContext: WorkspaceContext,
  visiting = new Set<string>(),
): Set<string> {
  const normalizedName = packageName.toLowerCase();
  if (visiting.has(normalizedName)) return new Set<string>();
  const workspacePackage = workspaceContext.packagesByName.get(packageName);
  if (!workspacePackage) return new Set<string>();

  visiting.add(normalizedName);
  const resources = new Set<string>();

  for (const resource of INTEGRATION_RESOURCES) {
    if (workspacePackage.files.some(file => fileContainsResourceCodeEvidence(file, resource))) {
      resources.add(resource.name);
    }
    if (workspacePackage.files.some(file => fileContainsResourcePackageEvidence(file, resource))) {
      resources.add(resource.name);
    }
  }

  for (const dependency of new Set([...workspacePackage.importedPackages, ...workspacePackage.manifestDependencies])) {
    const directResource = inferResourceFromPackageName(dependency);
    if (directResource) {
      resources.add(directResource);
      continue;
    }

    for (const nestedResource of collectWorkspacePackageResources(dependency, workspaceContext, visiting)) {
      resources.add(nestedResource);
    }
  }

  visiting.delete(normalizedName);
  return resources;
}

function detectSubmoduleHints(unit: ArchitecturalUnit): string[] {
  const counts = new Map<string, number>();

  for (const file of unit.files) {
    const relative = stripUnitPrefix(file.relativePath, unit.dirPath);
    const parts = relative.split('/').slice(0, -1);
    for (const part of parts) {
      const normalized = part.toLowerCase();
      if (isInterfaceLikeSegment(normalized)) continue;
      if (!SUBMODULE_SEGMENTS.has(normalized) && normalized.length < 4) continue;
      counts.set(normalized, (counts.get(normalized) || 0) + 1);
    }
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([segment]) => normalizeSubmoduleLabel(segment))
    .filter(Boolean);
}

function isInterfaceLikeSegment(segment: string): boolean {
  return !segment
    || /^\[.+\]$/.test(segment)
    || INTERFACE_LIKE_SUBMODULES.has(segment)
    || /^(v\d+|ai|cron)$/.test(segment);
}

function normalizeSubmoduleLabel(segment: string): string {
  if (!segment) return '';
  if (/^\(.+\)$/.test(segment)) {
    return humanizeName(segment.slice(1, -1));
  }
  return humanizeName(segment.replace(/^\[|\]$/g, ''));
}

function detectEntityHints(files: RepoFile[]): ArchitecturalUnit['entityHints'] {
  const entities = new Map<string, ArchitecturalUnit['entityHints'][number]>();
  const likelyEntityFiles = files.filter(file => /(entity|model|schema|types|dto|record|patient|medicine|table|db|data)/i.test(file.relativePath)).slice(0, 30);

  for (const file of likelyEntityFiles) {
    const content = readFileSafe(file.absolutePath);
    if (!content) continue;

    const patterns = [
      /\binterface\s+([A-Z][A-Za-z0-9]+)/g,
      /\btype\s+([A-Z][A-Za-z0-9]+)\s*=/g,
      /\bclass\s+([A-Z][A-Za-z0-9]+)/g,
      /\bmodel\s+([A-Z][A-Za-z0-9]+)/g,
    ];

    for (const pattern of patterns) {
      for (const match of content.matchAll(pattern)) {
        const name = match[1];
        if (!name || ENTITY_STOP_WORDS.has(name)) continue;
        entities.set(name, { name });
      }
    }
  }

  return [...entities.values()].slice(0, 12);
}

function inferHttpInterfaces(files: RepoFile[], dirPath: string): ArchitecturalUnit['interfaceHints'] {
  const interfaces: ArchitecturalUnit['interfaceHints'] = [];

  for (const file of files) {
    const relative = stripUnitPrefix(file.relativePath, dirPath);
    const routeMatch = relative.match(/(?:^|\/)(?:app|src\/app|pages|src\/pages)\/api\/(.+)\/route\.(ts|tsx|js|jsx)$/);
    if (routeMatch) {
      interfaces.push({ type: 'http', name: '/' + routeMatch[1].replace(/\/route$/, ''), description: 'Detected API route' });
      continue;
    }

    const legacyApiMatch = relative.match(/(?:^|\/)(?:pages|src\/pages)\/api\/(.+)\.(ts|tsx|js|jsx)$/);
    if (legacyApiMatch) {
      interfaces.push({ type: 'http', name: '/' + legacyApiMatch[1], description: 'Detected API route' });
      continue;
    }

    if (/(^|\/)middleware\.(ts|tsx|js|jsx)$/.test(relative)) {
      interfaces.push({ type: 'http', name: 'middleware', description: 'HTTP request middleware' });
    }
  }

  return dedupeInterfaces(interfaces);
}

function inferStaticPurpose(
  unit: ArchitecturalUnit,
  integrations: string[],
  interfaces: ArchitecturalUnit['interfaceHints'],
): string | undefined {
  const featureSummary = summarizeFeatureHints(unit.submoduleHints);
  const integrationSummary = summarizeDependencies(integrations);
  if (unit.kindHint === 'app' && /frontend/i.test(unit.name)) {
    return `${unit.name} is the user-facing frontend application${featureSummary ? ` for ${featureSummary}` : ''}${integrationSummary ? ` and integrates with ${integrationSummary}` : ''}.`;
  }
  if (/\bbff\b/i.test(unit.name) || unit.kindHint === 'gateway') {
    return `${unit.name} is the backend-for-frontend and API orchestration layer${interfaces.length ? ` exposing ${interfaces.length} interface(s)` : ''}${integrationSummary ? ` and integrating with ${integrationSummary}` : ''}.`;
  }
  if (unit.kindHint === 'resource') {
    return buildFallbackPurpose(unit);
  }
  if (interfaces.length > 0) {
    return `${unit.name} exposes ${interfaces.length} public interface(s) and service logic.`;
  }
  return undefined;
}

function detectCapabilityHints(
  unit: ArchitecturalUnit,
  interfaces: ArchitecturalUnit['interfaceHints'],
  submodules: string[],
): string[] {
  const capabilities: string[] = [];

  if (unit.kindHint === 'app') {
    for (const submodule of submodules.slice(0, 8)) {
      const capability = capabilityFromFeature(submodule);
      if (capability) capabilities.push(capability);
    }
  }

  for (const api of interfaces) {
    const capability = capabilityFromInterface(api.name, unit.files);
    if (capability) capabilities.push(capability);
  }

  return dedupeStrings(capabilities).slice(0, 12);
}

function capabilityFromFeature(submodule: string): string {
  const label = normalizeSubmoduleLabel(submodule);
  if (!label || ['App', 'API', 'Components', 'Lib', 'Server', 'Client'].includes(label)) return '';
  if (/dashboard/i.test(label)) return 'Review dashboard summaries and recent activity';
  if (/patient/i.test(label)) return 'Manage patients and their medical data';
  if (/record/i.test(label)) return 'Review and manage medical records';
  if (/medicine/i.test(label)) return 'Manage medicines and treatment details';
  if (/search/i.test(label)) return 'Search records and clinical information';
  if (/auth/i.test(label)) return 'Authenticate users and manage signed-in access';
  if (/settings/i.test(label)) return 'Configure account and workspace settings';
  if (/legal/i.test(label)) return 'Access legal, compliance, and policy information';
  if (/attachment/i.test(label)) return 'Manage attachments and supporting documents';
  if (/onboarding/i.test(label)) return 'Guide users through onboarding and setup';
  return `Support ${label.toLowerCase()} workflows`;
}

function capabilityFromInterface(interfaceName: string, files: RepoFile[]): string {
  if (!interfaceName || interfaceName === 'middleware') return '';

  const normalized = interfaceName.toLowerCase();
  if (/\/health$/.test(normalized) || /\/docs$/.test(normalized) || /^\/health$/.test(normalized)) return '';
  const targetFile = files.find(file => normalizedRouteFromPath(file.relativePath).toLowerCase() === normalized);
  const content = targetFile ? readFileSafe(targetFile.absolutePath) : '';
  const methods = [...content.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g)]
    .map(match => match[1].toUpperCase());
  const segments = normalized
    .replace(/^\/+/, '')
    .split('/')
    .filter(part => part && !part.startsWith('[') && !/^(ai|v\d+|cron)$/.test(part));

  if (segments.length === 0) return '';

  const last = segments[segments.length - 1];
  const parent = segments[segments.length - 2] || '';
  const subject = humanizeName(segments.slice(-2).join(' ')).toLowerCase();

  if (segments[0] === 'webhooks' && methods.includes('POST')) {
    return `Process ${humanizeName(segments[1] || 'external').toLowerCase()} webhooks`;
  }
  if (segments.join('/') === 'process-stuck-ai') return 'Process stuck AI jobs';
  if (segments.join('/') === 'onboarding/status') return 'Check onboarding status';
  if (segments.join('/') === 'onboarding/clone-test-patient') return 'Clone a test patient for onboarding';
  if (segments.join('/') === 'dashboard/stats') return 'Review dashboard statistics';
  if (segments.join('/') === 'chat/conversations') return 'Review chat conversations';
  if (segments.join('/') === 'subscription/usage') return 'Review subscription usage';
  if (segments.join('/') === 'search') return 'Search records and related information';
  if (segments.join('/') === 'auth/me') return 'View the signed-in user profile';
  if (segments.join('/') === 'auth/users') return methods.includes('GET') ? 'Review users and access assignments' : 'Manage users and access assignments';
  if (last === 'summarize') return `Summarize ${humanizeName(parent || 'content').toLowerCase()} with AI`;
  if (last === 'describe') return `Describe ${humanizeName(parent || 'content').toLowerCase()} with AI`;
  if (last === 'retry-ai') return `Retry AI processing for ${humanizeName(parent || 'records').toLowerCase()}`;
  if (last === 'upload-url') return `Generate upload URLs for ${humanizeName(parent || 'files').toLowerCase()}`;
  if (last === 'upload') return `Upload ${humanizeName(parent || 'files').toLowerCase()}`;
  if (last === 'download' || last === 'download-url') return `Download ${humanizeName(parent || 'files').toLowerCase()}`;
  if (last === 'stats') return `Review ${humanizeName(parent || 'dashboard').toLowerCase()} statistics`;
  if (last === 'recent') return `Review recent ${humanizeName(parent || 'items').toLowerCase()}`;
  if (last === 'usage') return `Review ${humanizeName(parent || 'usage').toLowerCase()}`;

  if (methods.includes('POST')) return `Create or submit ${subject}`;
  if (methods.includes('DELETE')) return `Delete ${subject}`;
  if (methods.includes('PATCH') || methods.includes('PUT')) return `Update ${subject}`;
  if (methods.includes('GET')) return `Read ${subject}`;

  return `Serve ${subject} operations`;
}

function buildIntegrationHints(
  unit: ArchitecturalUnit,
  integrations: string[],
): ArchitecturalUnit['integrationHints'] {
  return integrations.map(name => {
    const resource = INTEGRATION_RESOURCES.find(candidate => candidate.name === name);
    if (!resource) {
      return {
        name,
        description: `Integrates with ${humanizeName(name)} as part of ${unit.name}.`.slice(0, 200),
        internal: false,
      };
    }

    return {
      name,
      description: integrationDescriptionFor(resource),
      internal: false,
      category: resource.category,
    };
  });
}

function integrationDescriptionFor(resource: IntegrationResource): string {
  switch (resource.name) {
    case 'clerk':
      return 'Handles authentication, sessions, and user identity flows.';
    case 'llm':
      return 'Calls LLM APIs for summaries, chat responses, or other AI-generated outputs.';
    case 'dynamodb':
      return 'Stores and queries operational records in DynamoDB.';
    case 's3':
      return 'Uploads, stores, and retrieves files or attachments in S3.';
    case 'vector-search':
      return 'Indexes embeddings and runs semantic retrieval queries.';
    case 'redis':
      return 'Caches transient data or coordinates broker-style workflows.';
    case 'postgres':
      return 'Reads and writes relational data in PostgreSQL.';
    case 'stripe':
      return 'Handles billing, checkout, subscriptions, or payment webhooks.';
    default:
      return `Integrates with ${humanizeName(resource.name)}.`;
  }
}

function inferResourceCategory(name: string): ResourceCategory | undefined {
  const resource = INTEGRATION_RESOURCES.find(candidate => candidate.name === name.toLowerCase());
  return resource?.category;
}

function normalizedRouteFromPath(relativePath: string): string {
  const normalized = normalizePath(relativePath);
  const routeMatch = normalized.match(/(?:^|\/)(?:app|src\/app|pages|src\/pages)\/api\/(.+)\/route\.(ts|tsx|js|jsx)$/);
  if (routeMatch) {
    return '/' + routeMatch[1];
  }

  const legacyApiMatch = normalized.match(/(?:^|\/)(?:pages|src\/pages)\/api\/(.+)\.(ts|tsx|js|jsx)$/);
  if (legacyApiMatch) {
    return '/' + legacyApiMatch[1];
  }

  return '';
}

function fileContainsResourceEvidence(file: RepoFile, resource: IntegrationResource): boolean {
  return fileContainsResourcePackageEvidence(file, resource) || fileContainsResourceCodeEvidence(file, resource);
}

function fileContainsResourcePackageEvidence(file: RepoFile, resource: IntegrationResource): boolean {
  if (!/package\.json$/i.test(file.relativePath)) {
    return false;
  }

  const manifest = readJson(file.absolutePath);
  if (!manifest) return false;
  const dependencies = collectManifestDependencies(manifest);
  return resource.packages.some(packageName => dependencies.has(packageName.toLowerCase()));
}

function fileContainsResourceCodeEvidence(file: RepoFile, resource: IntegrationResource): boolean {
  if (/(\.md|\.html|\.css|\.scss|\.sass|\.less|\.txt)$/i.test(file.relativePath)) {
    return false;
  }

  if (/package\.json$/i.test(file.relativePath)) return false;

  if (!/\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|scala|cs|sql|graphql|gql|prisma)$/i.test(file.relativePath)) {
    return false;
  }

  const content = readFileSafe(file.absolutePath);
  if (!content) return false;
  return resource.codePatterns.some(pattern => pattern.test(content));
}

function collectImportedPackages(files: RepoFile[]): Set<string> {
  const imports = new Set<string>();

  for (const file of files) {
    if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(file.relativePath)) continue;
    const content = readFileSafe(file.absolutePath);
    if (!content) continue;

    const patterns = [
      /\bfrom\s+['"]([^'"]+)['"]/g,
      /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
      /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
    ];

    for (const pattern of patterns) {
      for (const match of content.matchAll(pattern)) {
        const packageName = normalizeImportPackageName(match[1]);
        if (packageName) imports.add(packageName);
      }
    }
  }

  return imports;
}

function normalizeImportPackageName(specifier: string): string | undefined {
  if (!specifier || specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) {
    return undefined;
  }
  if (specifier.startsWith('@/') || specifier.startsWith('~/')) {
    return undefined;
  }

  const parts = specifier.split('/');
  if (specifier.startsWith('@')) {
    if (parts.length < 2 || parts[0] === '@') return undefined;
    return `${parts[0]}/${parts[1]}`;
  }

  return parts[0] || undefined;
}

function inferResourceFromPackageName(packageName: string): string | undefined {
  const normalized = packageName.toLowerCase();
  return INTEGRATION_RESOURCES.find(resource =>
    resource.packages.some(candidate => candidate.toLowerCase() === normalized)
  )?.name;
}

function readFileSafe(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

function selectFilesForAnalysis(unit: ArchitecturalUnit): RepoFile[] {
  const scored = unit.files.map(file => ({ file, score: scoreFileForAnalysis(file, unit) }))
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, 48).map(entry => entry.file);
}

function scoreFileForAnalysis(file: RepoFile, unit: ArchitecturalUnit): number {
  const relative = stripUnitPrefix(file.relativePath, unit.dirPath).toLowerCase();
  let score = 1;

  if (/package\.json$/.test(relative)) score += 20;
  if (/(next\.config|middleware|instrumentation|turbo\.json|docker-compose|compose)/.test(relative)) score += 16;
  if (/(app\/api|pages\/api|server|route\.(ts|js)|controller|service|repository|handler|worker|job|queue)/.test(relative)) score += 14;
  if (/(schema|model|entity|table|db|data|record|patient|medicine)/.test(relative)) score += 12;
  if (/(components|app\/|pages\/|layout|page)/.test(relative)) score += 8;
  if (/(llm|clerk|auth|search|vector|redis|postgres|dynamodb|s3)/.test(relative)) score += 10;
  if (/\.d\.ts$/.test(relative)) score -= 5;
  if (/(dist|build|coverage|\.next|node_modules)\//.test(relative)) score -= 30;

  return score;
}

function synthesizeStaticArchitecture(
  services: ServiceDesignDoc[],
  repoStructure: string,
): {
  architectureType: SystemDesignResult['architectureType'];
  score: number;
  strengths: string[];
  weaknesses: string[];
  globalSummary: string;
} {
  const appCount = services.filter(service => service.kind === 'app').length;
  const gatewayCount = services.filter(service => service.kind === 'gateway').length;
  const resourceCount = services.filter(service => service.kind === 'resource').length;

  const architectureType = appCount > 0 && (gatewayCount > 0 || resourceCount > 0)
    ? 'hybrid-service-oriented'
    : services.length > 1
      ? 'modular-monolith'
      : 'monolith';

  return {
    architectureType,
    score: 70,
    strengths: ['Static architecture analysis completed without LLM runtime'],
    weaknesses: ['Narrative synthesis is heuristically generated'],
    globalSummary: `Detected ${services.length} architectural unit(s) from repository structure. ${repoStructure}.`,
  };
}

function detectComposeUnits(repoPath: string, index: RepoIndex): ArchitecturalUnit[] {
  const composeFiles = index.files.filter(file => isComposeFile(file.relativePath));
  const units: ArchitecturalUnit[] = [];

  for (const composeFile of composeFiles) {
    const services = parseComposeServices(composeFile.absolutePath);
    for (const service of services) {
      const files = new Map<string, RepoFile>();
      files.set(composeFile.relativePath, composeFile);

      const buildContext = resolveComposeBuildContext(repoPath, composeFile.relativePath, service.buildContext);
      if (buildContext && buildContext !== '.') {
        for (const file of index.files) {
          if (file.relativePath.startsWith(buildContext + '/')) {
            files.set(file.relativePath, file);
          }
        }
      } else {
        for (const file of findFilesForServiceName(index, service.name)) {
          files.set(file.relativePath, file);
        }
      }

      const kindHint = inferServiceKind(service.name, `${service.image || ''} ${buildContext || ''}`);
      const analysisHints: string[] = [
        `Detected from compose file: ${composeFile.relativePath}`,
      ];

      if (service.image) analysisHints.push(`Container image: ${service.image}`);
      if (buildContext && buildContext !== '.') analysisHints.push(`Build context: ${buildContext}`);
      if (service.dependsOn.length > 0) analysisHints.push(`Declared compose dependencies: ${service.dependsOn.join(', ')}`);

      units.push({
        name: service.name,
        dirPath: buildContext || `${composeFile.relativePath}#${service.name}`,
        files: [...files.values()],
        kindHint,
        resourceCategory: kindHint === 'resource' ? inferResourceCategory(service.name) : undefined,
        dependencyHints: service.dependsOn,
        analysisHints,
        capabilityHints: [],
        integrationHints: [],
        submoduleHints: [],
        entityHints: [],
        interfaceHints: [],
      });
    }
  }

  return units;
}

function isComposeFile(relativePath: string): boolean {
  const normalized = normalizePath(relativePath).toLowerCase();
  return /(^|\/)(docker-)?compose(\.[\w-]+)?\.ya?ml$/.test(normalized)
    || /(^|\/)compose(\.[\w-]+)?\.ya?ml$/.test(normalized);
}

function resolveComposeBuildContext(repoPath: string, composeRelativePath: string, buildContext?: string): string | undefined {
  if (!buildContext) return undefined;
  const composeDir = path.dirname(path.join(repoPath, composeRelativePath));
  const resolved = path.resolve(composeDir, buildContext);

  if (!resolved.startsWith(path.resolve(repoPath))) {
    return undefined;
  }

  const relative = normalizePath(path.relative(repoPath, resolved));
  return relative || '.';
}

function findFilesForServiceName(index: RepoIndex, serviceName: string): RepoFile[] {
  const normalizedName = serviceName.toLowerCase();
  const exactPrefixes = COMMON_SERVICE_PREFIXES.map(prefix => normalizePath(`${prefix}/${normalizedName}`));

  for (const prefix of exactPrefixes) {
    const files = index.files.filter(file => file.relativePath.startsWith(prefix + '/'));
    if (files.length > 0) return files;
  }

  const directFiles = index.files.filter(file => file.relativePath.startsWith(normalizedName + '/'));
  if (directFiles.length > 0) return directFiles;

  return [];
}

type ParsedComposeService = {
  name: string;
  image?: string;
  buildContext?: string;
  dependsOn: string[];
};

function parseComposeServices(filePath: string): ParsedComposeService[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);
  const services: ParsedComposeService[] = [];

  let inServices = false;
  let servicesIndent = -1;
  let current: ParsedComposeService | null = null;
  let currentIndent = -1;
  let inDependsOn = false;
  let dependsOnIndent = -1;
  let inBuildBlock = false;
  let buildBlockIndent = -1;

  const flushCurrent = () => {
    if (!current) return;
    current.dependsOn = [...new Set(current.dependsOn)];
    services.push(current);
    current = null;
    currentIndent = -1;
    inDependsOn = false;
    inBuildBlock = false;
  };

  for (const rawLine of lines) {
    const indent = rawLine.match(/^\s*/)?.[0].length || 0;
    const line = rawLine.replace(/\s+#.*$/, '');
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (!inServices) {
      if (/^services:\s*$/.test(trimmed)) {
        inServices = true;
        servicesIndent = indent;
      }
      continue;
    }

    if (indent <= servicesIndent && !/^services:\s*$/.test(trimmed)) {
      flushCurrent();
      inServices = false;
      continue;
    }

    const serviceMatch = trimmed.match(/^([A-Za-z0-9_.-]+):\s*$/);
    if (serviceMatch && indent === servicesIndent + 2) {
      flushCurrent();
      current = { name: serviceMatch[1], dependsOn: [] };
      currentIndent = indent;
      continue;
    }

    if (!current) continue;

    if (indent <= currentIndent) {
      flushCurrent();
      continue;
    }

    const imageMatch = trimmed.match(/^image:\s*(.+)$/);
    if (imageMatch) {
      current.image = stripWrappingQuotes(imageMatch[1]);
      inBuildBlock = false;
      continue;
    }

    const buildObjectMatch = trimmed.match(/^build:\s*\{.*context:\s*([^,}]+).*}$/);
    if (buildObjectMatch) {
      current.buildContext = stripWrappingQuotes(buildObjectMatch[1]);
      continue;
    }

    const buildInlineMatch = trimmed.match(/^build:\s*(.+)$/);
    if (buildInlineMatch) {
      const buildValue = stripWrappingQuotes(buildInlineMatch[1]);
      if (buildValue && buildValue !== '{}') {
        current.buildContext = buildValue;
      } else {
        inBuildBlock = true;
        buildBlockIndent = indent;
      }
      continue;
    }

    if (inBuildBlock) {
      if (indent <= buildBlockIndent) {
        inBuildBlock = false;
      } else {
        const contextMatch = trimmed.match(/^context:\s*(.+)$/);
        if (contextMatch) {
          current.buildContext = stripWrappingQuotes(contextMatch[1]);
          continue;
        }
      }
    }

    const dependsOnInlineMatch = trimmed.match(/^depends_on:\s*\[([^\]]+)\]\s*$/);
    if (dependsOnInlineMatch) {
      current.dependsOn.push(...dependsOnInlineMatch[1]
        .split(',')
        .map(value => stripWrappingQuotes(value.trim()))
        .filter(Boolean));
      continue;
    }

    if (/^depends_on:\s*$/.test(trimmed)) {
      inDependsOn = true;
      dependsOnIndent = indent;
      continue;
    }

    if (inDependsOn) {
      if (indent <= dependsOnIndent) {
        inDependsOn = false;
      } else {
        const listMatch = trimmed.match(/^-\s*([A-Za-z0-9_.-]+)/);
        const mapMatch = trimmed.match(/^([A-Za-z0-9_.-]+):\s*$/);
        const inlineListMatch = trimmed.match(/^\[([^\]]+)\]$/);
        if (listMatch) {
          current.dependsOn.push(listMatch[1]);
        } else if (mapMatch) {
          current.dependsOn.push(mapMatch[1]);
        } else if (inlineListMatch) {
          current.dependsOn.push(...inlineListMatch[1].split(',').map(value => stripWrappingQuotes(value.trim())).filter(Boolean));
        }
      }
    }
  }

  flushCurrent();
  return services;
}

function stripWrappingQuotes(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '');
}

export function resolveSystemDesignTemplatePath(): string {
  for (const candidate of SYSTEM_DESIGN_TEMPLATE_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`System design template not found. Checked: ${SYSTEM_DESIGN_TEMPLATE_CANDIDATES.join(', ')}`);
}

function generateHTMLReport(outputDir: string, graph: import('../../../types/index').ArchitectureGraph): void {
  const templatePath = resolveSystemDesignTemplatePath();
  let template = fs.readFileSync(templatePath, 'utf-8');
  template = template.replace('__CODEOWL_DATA__', JSON.stringify(graph));
  writeText(path.join(outputDir, 'index.html'), template);
}
