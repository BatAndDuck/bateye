import * as fs from 'fs';
import * as path from 'path';
import execa from 'execa';
import { z } from 'zod';
import { RepoFile, RepoIndex, ResourceCategory, ServiceDesignDoc, ServiceInterfaceType, ServiceKind, SystemDesignInventory, SystemDesignResult } from '../../../types/index';
import { buildRepoIndex, formatFilesForContext, readFileContent } from '../../../core/indexing/index';
import { createRuntime, getRuntime } from '../../../core/runtime/factory';
import { serviceDesignDocSchema, ServiceDoc } from '../../../core/validation/schemas';
import {
  buildFileSummarySystemPrompt,
  buildFileSummaryUserMessage,
  buildRelevantFileSelectionSystemPrompt,
  buildRelevantFileSelectionUserMessage,
  buildServiceAnalysisSystemPrompt,
  buildServiceAnalysisUserMessage,
  buildServiceSynthesisFromFilesSystemPrompt,
  buildServiceSynthesisFromFilesUserMessage,
} from '../../../core/prompts/system-design';
import { synthesizeArchitecture } from '../../../core/system-design/synthesizer';
import { buildGraph } from '../../../core/system-design/graph';
import { ensureDir, writeJson, writeSystemDesignResult, writeText } from '../../../core/output/writer';
import { SYSTEM_DESIGN_OUTPUT_DIR } from '../../../core/config/defaults';
import { listTopLevelDirs } from '../../../core/git/index';
import { IRuntime, RunResult } from '../../../core/runtime/interface';
import { resolveApiKey, resolveConfig } from '../../config/application/config-service';

const SYSTEM_DESIGN_TEMPLATE_CANDIDATES = [
  path.resolve(__dirname, '../assets/index.html'),
  path.resolve(__dirname, '../../../../src/features/system-design/assets/index.html'),
];
const DEPENDENCY_CRUISER_BIN_CANDIDATES = [
  path.resolve(__dirname, '../../../../node_modules/.bin/depcruise.cmd'),
  path.resolve(__dirname, '../../../../node_modules/.bin/depcruise'),
  path.resolve(process.cwd(), 'node_modules/.bin/depcruise.cmd'),
  path.resolve(process.cwd(), 'node_modules/.bin/depcruise'),
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
  { name: 'mongo', description: 'MongoDB document datastore', category: 'database', packages: ['mongodb', 'mongoose'], codePatterns: [/^\s*import\s+.*['"]mongodb['"]/m, /^\s*import\s+.*['"]mongoose['"]/m, /mongodb:\/\//i] },
  { name: 'azure.storage', description: 'Azure Storage or Azurite blob/queue storage', category: 'storage', packages: ['@azure/storage-blob', '@azure/storage-queue'], codePatterns: [/^\s*import\s+.*@azure\/storage-(blob|queue)/m, /DefaultEndpointsProtocol=https;AccountName=/i] },
  { name: 'mongo-express', description: 'MongoDB administrative UI', category: 'internal-platform', packages: [], codePatterns: [] },
  { name: 'seq', description: 'Structured log aggregation and search service', category: 'internal-platform', packages: [], codePatterns: [] },
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

const relevantFileSelectionSchema = z.object({
  filePaths: z.array(z.string()),
  reasons: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).default(0.5),
  gaps: z.array(z.string()).default([]),
});

const fileSummarySchema = z.object({
  summary: z.string(),
  interfaces: z.array(z.object({
    type: z.enum(['http', 'graphql', 'event', 'queue', 'cron', 'db']),
    name: z.string(),
    description: z.string().optional(),
  })).default([]),
  integrations: z.array(z.object({
    name: z.string(),
    description: z.string().max(200),
    internal: z.boolean(),
    category: z.enum([
      'database',
      'cache',
      'queue',
      'storage',
      'vector-search',
      'external-saas',
      'external-api',
      'internal-platform',
    ]).optional(),
    instanceKey: z.string().optional(),
  })).default([]),
  dependencies: z.array(z.string()).default([]),
  entities: z.array(z.object({
    name: z.string(),
    description: z.string().optional(),
    fields: z.array(z.string()).optional(),
  })).default([]),
  submodules: z.array(z.string()).default([]),
  capabilities: z.array(z.string()).default([]),
  importance: z.number().int().min(1).max(10).default(5),
});

type FileSummary = z.infer<typeof fileSummarySchema> & {
  filePath: string;
};

type RelevantFileSelectionResult = {
  seedFiles: RepoFile[];
  candidateFiles: RepoFile[];
  selectedFiles: RepoFile[];
  retrievalIterations: number;
  confidence: number;
  reasons: string[];
  gaps: string[];
  dependencyCruiser: DependencyCruiserInsights | null;
};

type UnitAnalysisResult = {
  service: ServiceDesignDoc;
  seedFiles: string[];
  candidateFiles: string[];
  selectedFiles: string[];
  fileSummaries: FileSummary[];
  retrievalIterations: number;
  selectionConfidence: number;
  selectionReasons: string[];
  dependencyCruiser: DependencyCruiserInsights | null;
};

type DependencyCruiserEdge = {
  sourcePath: string;
  targetPath: string;
};

type DependencyCruiserInsights = {
  reachableFiles: RepoFile[];
  importEdges: DependencyCruiserEdge[];
  npmPackages: string[];
  integrations: ServiceDesignDoc['integrations'];
  warnings: string[];
};

type DependencyCruiserReport = {
  modules?: Array<{
    source: string;
    dependencies?: Array<{
      module?: string;
      resolved?: string;
      dependencyTypes?: string[];
      coreModule?: boolean;
      couldNotResolve?: boolean;
    }>;
  }>;
};

type AIRuntimeContext = {
  apiKey: string | null;
  runtime: IRuntime | null;
  enabled: boolean;
  authFailureMessage?: string;
};

const dependencyCruiserCache = new Map<string, Promise<DependencyCruiserInsights | null>>();

export async function runSystemDesign(
  options: SystemDesignOptions,
  dependencies: SystemDesignDependencies = defaultDependencies,
): Promise<SystemDesignResult> {
  const { repoPath, onProgress } = options;
  const log = (msg: string) => onProgress?.(msg);
  const outputDir = options.outputDir || path.join(repoPath, SYSTEM_DESIGN_OUTPUT_DIR);

  log('Loading configuration...');
  const config = resolveConfig(repoPath);
  const apiKey = resolveSystemDesignApiKey(config, log);

  log('Indexing repository...');
  const index = await buildRepoIndex(repoPath, config);
  log(`Found ${index.totalFiles} files.`);

  log('Detecting services and modules...');
  const units = await detectArchitecturalUnits(repoPath, index);
  log(`Detected ${units.length} architectural unit(s): ${units.map(unit => unit.name).join(', ')}`);

  const runtime = apiKey ? await resolveSystemDesignRuntime(dependencies, log) : null;
  const aiContext: AIRuntimeContext = {
    apiKey,
    runtime,
    enabled: Boolean(apiKey && runtime),
  };
  const { services, unitAnalyses } = await analyzeArchitecturalUnits(units, index, config.model, aiContext, log);

  reconcileServiceConnections(services, unitAnalyses, index);
  const coverage = buildCoverageSummary(unitAnalyses, services);
  appendIntegrationServices(services);
  const repoStructure = await buildRepoStructureSummary(repoPath, index.totalFiles);

  log('Synthesizing architecture...');
  const synthesis = aiContext.enabled && aiContext.apiKey
    ? await synthesizeArchitecture(services, repoStructure, config.model, aiContext.apiKey, coverage, config.transport, config.apiBaseUrl)
    : synthesizeStaticArchitecture(services, repoStructure);
  const result = buildSystemDesignResult(repoPath, outputDir, synthesis, services, coverage);

  log('Writing output files...');
  const graph = writeSystemDesignOutputs(outputDir, result, unitAnalyses, units);
  log(`✓ HTML report: ${path.join(outputDir, 'index.html')}`);

  return result;
}

function resolveSystemDesignApiKey(
  config: ReturnType<typeof resolveConfig>,
  logProgress: (msg: string) => void,
): string | null {
  try {
    return resolveApiKey(config);
  } catch (err) {
    logProgress(`API key unavailable, continuing with static architecture analysis: ${(err as Error).message}`);
    return null;
  }
}

async function analyzeArchitecturalUnits(
  units: ArchitecturalUnit[],
  index: RepoIndex,
  model: string,
  aiContext: AIRuntimeContext,
  logProgress: (msg: string) => void,
): Promise<{ services: ServiceDesignDoc[]; unitAnalyses: UnitAnalysisResult[] }> {
  const services: ServiceDesignDoc[] = [];
  const unitAnalyses: UnitAnalysisResult[] = [];

  for (const unit of units) {
    logProgress(`Analyzing: ${unit.name}...`);
    const analysis = await analyzeUnit(unit, index, model, aiContext, logProgress);
    services.push(analysis.service);
    unitAnalyses.push(analysis);
    logProgress(`  ✓ ${unit.name}: ${analysis.service.kind} from ${analysis.fileSummaries.length} file summary(ies)`);
  }

  return { services, unitAnalyses };
}

function appendIntegrationServices(services: ServiceDesignDoc[]): void {
  const integrationServices = buildIntegrationServices(services);
  for (const integrationService of integrationServices) {
    if (!services.some(service => service.serviceId === integrationService.serviceId)) {
      services.push(integrationService);
    }
  }
}

async function buildRepoStructureSummary(repoPath: string, totalFiles: number): Promise<string> {
  const topLevelDirs = await listTopLevelDirs(repoPath);
  return `Top-level directories: ${topLevelDirs.join(', ')}\nTotal files: ${totalFiles}`;
}

function buildSystemDesignResult(
  repoPath: string,
  outputDir: string,
  synthesis: Awaited<ReturnType<typeof synthesizeArchitecture>> | ReturnType<typeof synthesizeStaticArchitecture>,
  services: ServiceDesignDoc[],
  coverage: SystemDesignResult['coverage'],
): SystemDesignResult {
  const generatedAt = new Date().toISOString();
  return {
    command: 'system-design',
    repoPath: path.resolve(repoPath),
    architectureType: synthesis.architectureType,
    score: synthesis.score,
    strengths: synthesis.strengths,
    weaknesses: synthesis.weaknesses,
    services,
    globalSummary: synthesis.globalSummary,
    coverage,
    artifacts: {
      htmlReportPath: path.join(outputDir, 'index.html'),
      graphDataPath: path.join(outputDir, 'graph.json'),
      servicesDir: path.join(outputDir, 'services'),
      unitsDir: path.join(outputDir, 'units'),
      inventoryPath: path.join(outputDir, 'inventory.json'),
      coveragePath: path.join(outputDir, 'coverage.json'),
      architecturePath: path.join(outputDir, 'architecture.json'),
    },
    generatedAt,
  };
}

/**
 * Writes all system design output files to disk and returns the architecture graph.
 * Produces per-unit JSON docs, graph data, inventory, coverage, architecture summary, and the HTML report.
 */
function writeSystemDesignOutputs(
  outputDir: string,
  result: SystemDesignResult,
  unitAnalyses: UnitAnalysisResult[],
  detectedUnits: ArchitecturalUnit[],
): ReturnType<typeof buildGraph> {
  const { coverage, services } = result;
  const generatedAt = result.generatedAt;

  ensureDir(outputDir);
  writeSystemDesignResult(outputDir, result);
  ensureDir(result.artifacts.unitsDir);
  writeUnitAnalysisOutputs(result.artifacts.unitsDir, unitAnalyses);

  const graph = buildGraph(result);
  writeJson(path.join(outputDir, 'graph.json'), graph);
  writeJson(result.artifacts.coveragePath, coverage);
  writeJson(result.artifacts.inventoryPath, buildInventoryOutput(result, unitAnalyses, detectedUnits));
  writeJson(result.artifacts.architecturePath, {
    architectureType: result.architectureType,
    score: result.score,
    strengths: result.strengths,
    weaknesses: result.weaknesses,
    globalSummary: result.globalSummary,
    coverage,
    services,
    generatedAt,
  });
  writeJson(path.join(outputDir, 'summary.json'), {
    architectureType: result.architectureType,
    score: result.score,
    strengths: result.strengths,
    weaknesses: result.weaknesses,
    globalSummary: result.globalSummary,
    serviceCount: services.length,
    coverage,
    generatedAt,
  });

  generateHTMLReport(outputDir, graph);
  return graph;
}

function writeUnitAnalysisOutputs(unitsDir: string, unitAnalyses: UnitAnalysisResult[]): void {
  for (const analysis of unitAnalyses) {
    writeJson(path.join(unitsDir, `${analysis.service.serviceId}.json`), {
      serviceId: analysis.service.serviceId,
      name: analysis.service.name,
      kind: analysis.service.kind,
      seedFiles: analysis.seedFiles,
      candidateFiles: analysis.candidateFiles,
      selectedFiles: analysis.selectedFiles,
      fileSummaries: analysis.fileSummaries,
      integrations: analysis.service.integrations,
      dependencies: analysis.service.dependencies,
      publicInterfaces: analysis.service.publicInterfaces,
      confidence: analysis.service.confidence,
      selectionConfidence: analysis.selectionConfidence,
      selectionReasons: analysis.selectionReasons,
      retrievalIterations: analysis.retrievalIterations,
      dependencyCruiser: analysis.dependencyCruiser
        ? {
          reachableFiles: analysis.dependencyCruiser.reachableFiles.map(file => file.relativePath),
          npmPackages: analysis.dependencyCruiser.npmPackages,
          importEdges: analysis.dependencyCruiser.importEdges,
          integrations: analysis.dependencyCruiser.integrations,
          warnings: analysis.dependencyCruiser.warnings,
        }
        : null,
      gaps: analysis.service.gaps,
      conflicts: analysis.service.conflicts,
    });
  }
}

function buildInventoryOutput(
  result: SystemDesignResult,
  unitAnalyses: UnitAnalysisResult[],
  detectedUnits: ArchitecturalUnit[],
): SystemDesignInventory {
  return {
    generatedAt: result.generatedAt,
    repoPath: result.repoPath,
    units: unitAnalyses.map(analysis => ({
      unitId: analysis.service.serviceId,
      name: analysis.service.name,
      kindHint: analysis.service.kind,
      dirPath: detectedUnits.find(unit => unit.name === analysis.service.name)?.dirPath || analysis.service.serviceId,
      seedFiles: analysis.seedFiles,
      candidateFiles: analysis.candidateFiles,
      selectedFiles: analysis.selectedFiles,
      dependencyHints: analysis.service.dependencies,
      integrationHints: analysis.service.integrations,
      discoverySources: analysis.service.discoverySources,
      evidence: analysis.fileSummaries.map(summary => ({ filePath: summary.filePath, reason: summary.summary })),
      confidence: analysis.service.confidence,
    })),
    integrations: result.services.flatMap(service => service.integrations.filter(integration => !integration.internal)),
    gaps: result.coverage.gaps,
    conflicts: result.coverage.conflicts,
  };
}

/** A detected architectural unit (service, module, or app) with its directory path and enriched analysis hints */
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

/** Detect architectural units by scanning repository structure, workspace manifests, and compose definitions. */
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
  for (const unit of detectContainerDirUnits(repoPath, index)) {
    addUnit(unit.name, unit.dirPath, unit.files, unit);
  }

  // Phase 3: Common top-level service/resource directories.
  for (const unit of detectTopLevelServiceDirUnits(repoPath, index)) {
    addUnit(unit.name, unit.dirPath, unit.files, unit);
  }

  // Phase 4: Look under src/ and common containers inside src/.
  for (const unit of detectSrcDirUnits(repoPath, index, hasRootApplicationBoundary)) {
    addUnit(unit.name, unit.dirPath, unit.files, unit);
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
  index: RepoIndex,
  model: string,
  aiContext: AIRuntimeContext,
  log: (msg: string) => void,
): Promise<UnitAnalysisResult> {
  const selection = await selectRelevantFilesForUnit(unit, index, model, aiContext, log);

  let fileSummaries: FileSummary[];
  try {
    fileSummaries = await summarizeSelectedFiles(unit, selection.selectedFiles, model, aiContext, log);
  } catch (err) {
    log(`  Warning: file summarization failed for ${unit.name}, using static analysis: ${(err as Error).message}`);
    fileSummaries = [];
  }

  let synthesized: ServiceDesignDoc;
  try {
    synthesized = await synthesizeServiceFromFileSummaries(unit, fileSummaries, model, aiContext, log);
  } catch (err) {
    log(`  Warning: service synthesis failed for ${unit.name}, falling back to static doc: ${(err as Error).message}`);
    synthesized = buildStaticServiceDoc(unit, selection.selectedFiles.map(f => f.relativePath));
  }

  const service = enrichServiceDocFromFileSummaries(unit, synthesized, selection, fileSummaries);

  return {
    service,
    seedFiles: selection.seedFiles.map(file => file.relativePath),
    candidateFiles: selection.candidateFiles.map(file => file.relativePath),
    selectedFiles: selection.selectedFiles.map(file => file.relativePath),
    fileSummaries,
    retrievalIterations: selection.retrievalIterations,
    selectionConfidence: selection.confidence,
    selectionReasons: selection.reasons,
    dependencyCruiser: selection.dependencyCruiser,
  };
}

function buildStaticServiceDoc(unit: ArchitecturalUnit, evidenceFiles: string[] = unit.files.map(file => file.relativePath)): ServiceDesignDoc {
  const architectureRelevantFiles = evidenceFiles.length > 0
    ? evidenceFiles
    : selectDeterministicSeedFiles(unit, { includeCrossUnitFiles: false }).map(file => file.relativePath);

  return ensureServiceDoc(unit, {
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
    confidence: 0.45,
    evidence: {
      filePaths: architectureRelevantFiles,
      reasons: unit.analysisHints.slice(0, 12),
    },
    discoverySources: unit.analysisHints,
    gaps: [],
    conflicts: [],
  });
}

function ensureServiceDoc(unit: ArchitecturalUnit, doc: ServiceDesignDoc): ServiceDesignDoc {
  return {
    ...doc,
    confidence: doc.confidence ?? 0.5,
    evidence: {
      filePaths: uniqueStrings(doc.evidence?.filePaths || unit.files.map(file => file.relativePath)),
      reasons: doc.evidence?.reasons || unit.analysisHints.slice(0, 12),
    },
    discoverySources: doc.discoverySources?.length ? doc.discoverySources : unit.analysisHints,
    gaps: doc.gaps || [],
    conflicts: doc.conflicts || [],
  };
}

function buildCoverageSummary(
  unitAnalyses: UnitAnalysisResult[],
  services: ServiceDesignDoc[],
): SystemDesignResult['coverage'] {
  const unitCoverage = unitAnalyses.map(analysis => ({
    unitId: analysis.service.serviceId,
    name: analysis.service.name,
    confidence: analysis.service.confidence,
    seedFileCount: analysis.seedFiles.length,
    selectedFileCount: analysis.selectedFiles.length,
    analyzedFileCount: analysis.fileSummaries.length,
    retrievalIterations: analysis.retrievalIterations,
    gaps: analysis.service.gaps,
    conflicts: analysis.service.conflicts,
  }));
  const overallConfidence = unitCoverage.length === 0
    ? 0
    : unitCoverage.reduce((sum, service) => sum + service.confidence, 0) / unitCoverage.length;

  return {
    overallConfidence,
    gaps: uniqueStrings(services.flatMap(service => service.gaps)),
    conflicts: uniqueStrings(services.flatMap(service => service.conflicts)),
    unitCoverage,
  };
}

function reconcileServiceConnections(
  services: ServiceDesignDoc[],
  unitAnalyses: UnitAnalysisResult[],
  index: RepoIndex,
): void {
  const filesByPath = new Map(index.files.map(file => [file.relativePath, file]));
  const serviceById = new Map(services.map(service => [service.serviceId, service]));
  const serviceIdByFilePath = new Map<string, string>();

  for (const analysis of unitAnalyses) {
    for (const filePath of analysis.selectedFiles) {
      serviceIdByFilePath.set(filePath, analysis.service.serviceId);
    }
  }

  for (const analysis of unitAnalyses) {
    const service = serviceById.get(analysis.service.serviceId);
    if (!service) continue;
    const files = analysis.selectedFiles
      .map(filePath => filesByPath.get(filePath))
      .filter((file): file is RepoFile => Boolean(file));
    const extractedInterfaces = extractPublicInterfacesFromFiles(files);
    if (extractedInterfaces.length > 0) {
      service.publicInterfaces = dedupeInterfaces([...(service.publicInterfaces || []), ...extractedInterfaces]);
    }
  }

  const serviceRouteInventory = services
    .filter(service => service.kind !== 'resource')
    .map(service => ({
      service,
      routes: (service.publicInterfaces || [])
        .filter(iface => iface.type === 'http')
        .map(iface => ({
          method: normalizeHttpMethodPrefix(iface.name),
          path: normalizeHttpPath(stripHttpMethodPrefix(iface.name)),
          raw: iface.name,
        }))
        .filter(route => route.path),
    }))
    .filter(entry => entry.routes.length > 0);

  for (const analysis of unitAnalyses) {
    const service = serviceById.get(analysis.service.serviceId);
    if (!service || service.kind === 'resource') continue;

    const files = analysis.selectedFiles
      .map(filePath => filesByPath.get(filePath))
      .filter((file): file is RepoFile => Boolean(file));
    const outboundCalls = dedupeHttpCalls(extractOutboundHttpCalls(files));
    const matchedDependencies = new Set<string>(service.dependencies || []);
    const matchedIntegrations = [...(service.integrations || [])];

    for (const edge of analysis.dependencyCruiser?.importEdges || []) {
      const targetServiceId = serviceIdByFilePath.get(edge.targetPath);
      if (!targetServiceId || targetServiceId === service.serviceId) continue;
      const targetService = serviceById.get(targetServiceId);
      if (targetService) {
        matchedDependencies.add(targetService.name);
      }
    }

    for (const call of outboundCalls) {
      const targetService = findBestServiceForHttpCall(call, serviceRouteInventory, service.serviceId);
      if (targetService) {
        matchedDependencies.add(targetService.name);
        continue;
      }

      if (call.host && !isLikelyInternalHost(call.host)) {
        matchedIntegrations.push({
          name: call.host,
          description: `Calls external HTTP endpoint ${call.host}${call.path || ''}`.slice(0, 200),
          internal: false,
          category: 'external-api',
          instanceKey: call.host,
        });
      }
    }

    service.dependencies = uniqueStrings([...matchedDependencies])
      .filter(dependency => !dependency.startsWith('/'));
    service.integrations = dedupeIntegrations(matchedIntegrations);
  }
}

async function selectRelevantFilesForUnit(
  unit: ArchitecturalUnit,
  index: RepoIndex,
  model: string,
  aiContext: AIRuntimeContext,
  log: (msg: string) => void,
): Promise<RelevantFileSelectionResult> {
  const candidateFiles = index.files.filter(isArchitectureRelevantFile);
  const candidatePool = new Map(candidateFiles.map(file => [file.relativePath, file]));
  const seedFiles = selectDeterministicSeedFiles(unit);
  const selected = new Map(seedFiles.map(file => [file.relativePath, file]));
  let dependencyCruiser = createEmptyDependencyCruiserInsights();
  const reasons = [
    `Deterministic seeds selected from ${seedFiles.length} architecture-relevant file(s).`,
  ];
  const gaps: string[] = [];

  dependencyCruiser = mergeDependencyCruiserInsights(
    dependencyCruiser,
    await runDependencyCruiser(unit, [...selected.values()], index, log),
  );
  applyDependencyCruiserInsights(unit, dependencyCruiser, selected, candidatePool, reasons, gaps);

  if (!aiContext.enabled || !aiContext.apiKey || !aiContext.runtime) {
    return {
      seedFiles,
      candidateFiles: sortFilesForAnalysis([...candidatePool.values()], unit),
      selectedFiles: sortFilesForAnalysis([...selected.values()], unit),
      retrievalIterations: 0,
      confidence: seedFiles.length > 0 ? 0.55 : 0.35,
      reasons,
      gaps,
      dependencyCruiser,
    };
  }

  const chunkSize = 250;
  const maxIterations = 2;
  let retrievalIterations = 0;
  const confidences: number[] = [];

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    retrievalIterations += 1;
    let newSelections = 0;
    const remainingFiles = candidateFiles.filter(file => !selected.has(file.relativePath));

    for (const chunk of chunkFiles(remainingFiles, chunkSize)) {
      if (chunk.length === 0) continue;
      try {
        const result = await runSystemDesignAIRuntime(
          aiContext,
          {
            systemPrompt: buildRelevantFileSelectionSystemPrompt(),
            userMessage: buildRelevantFileSelectionUserMessage(
              unit.name,
              buildUnitAnalysisHints(unit),
              [...selected.keys()],
              chunk.map(file => file.relativePath),
            ),
            model,
            apiKey: aiContext.apiKey,
            maxTokens: 4096,
          },
          relevantFileSelectionSchema,
          log,
        );
        if (!result) {
          break;
        }

        const selection = relevantFileSelectionSchema.parse(result.data);
        confidences.push(selection.confidence);
        reasons.push(...selection.reasons);
        gaps.push(...selection.gaps);

        for (const filePath of selection.filePaths) {
          const file = chunk.find(candidate => candidate.relativePath === filePath);
          if (file && !selected.has(file.relativePath)) {
            selected.set(file.relativePath, file);
            newSelections += 1;
          }
        }
      } catch (err) {
        if (handleSystemDesignAIError(aiContext, err, log, `relevant-file selection for ${unit.name}`)) {
          break;
        }
        log(`  Warning: relevant-file selection failed for ${unit.name}: ${(err as Error).message}`);
        gaps.push(`AI file-selection failed for one inventory chunk: ${(err as Error).message}`);
      }
    }

    if (!aiContext.enabled) {
      break;
    }

    if (newSelections === 0) {
      break;
    }
  }

  dependencyCruiser = mergeDependencyCruiserInsights(
    dependencyCruiser,
    await runDependencyCruiser(unit, [...selected.values()], index, log),
  );
  applyDependencyCruiserInsights(unit, dependencyCruiser, selected, candidatePool, reasons, gaps);

  const selectedFiles = sortFilesForAnalysis([...selected.values()], unit);
  return {
    seedFiles,
    candidateFiles: sortFilesForAnalysis([...candidatePool.values()], unit),
    selectedFiles,
    retrievalIterations,
    confidence: confidences.length > 0
      ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
      : 0.7,
    reasons: uniqueStrings(reasons).slice(0, 60),
    gaps: uniqueStrings(gaps),
    dependencyCruiser,
  };
}

function createEmptyDependencyCruiserInsights(): DependencyCruiserInsights {
  return {
    reachableFiles: [],
    importEdges: [],
    npmPackages: [],
    integrations: [],
    warnings: [],
  };
}

function mergeDependencyCruiserInsights(
  base: DependencyCruiserInsights,
  next: DependencyCruiserInsights | null,
): DependencyCruiserInsights {
  if (!next) return base;
  return {
    reachableFiles: dedupeRepoFiles([...base.reachableFiles, ...next.reachableFiles]),
    importEdges: dedupeDependencyCruiserEdges([...base.importEdges, ...next.importEdges]),
    npmPackages: uniqueStrings([...base.npmPackages, ...next.npmPackages]),
    integrations: dedupeIntegrations([...base.integrations, ...next.integrations]),
    warnings: uniqueStrings([...base.warnings, ...next.warnings]),
  };
}

function dedupeDependencyCruiserEdges(edges: DependencyCruiserEdge[]): DependencyCruiserEdge[] {
  const seen = new Set<string>();
  const result: DependencyCruiserEdge[] = [];
  for (const edge of edges) {
    const key = `${edge.sourcePath}->${edge.targetPath}`;
    if (!edge.sourcePath || !edge.targetPath || seen.has(key)) continue;
    seen.add(key);
    result.push(edge);
  }
  return result;
}

function applyDependencyCruiserInsights(
  unit: ArchitecturalUnit,
  insights: DependencyCruiserInsights | null,
  selected: Map<string, RepoFile>,
  candidatePool: Map<string, RepoFile>,
  reasons: string[],
  gaps: string[],
): void {
  if (!insights) return;

  let addedFiles = 0;
  for (const file of insights.reachableFiles) {
    candidatePool.set(file.relativePath, file);
    if (!selected.has(file.relativePath)) {
      selected.set(file.relativePath, file);
      addedFiles += 1;
    }
  }

  if (addedFiles > 0) {
    reasons.push(`Dependency-cruiser added ${addedFiles} import-reachable file(s) for ${unit.name}.`);
  }
  if (insights.npmPackages.length > 0) {
    reasons.push(`Dependency-cruiser observed npm dependencies: ${insights.npmPackages.slice(0, 12).join(', ')}.`);
  }
  gaps.push(...insights.warnings);
}

async function runDependencyCruiser(
  unit: ArchitecturalUnit,
  selectedFiles: RepoFile[],
  index: RepoIndex,
  log: (msg: string) => void,
): Promise<DependencyCruiserInsights | null> {
  const targetFiles = selectedFiles.filter(isDependencyCruiserRelevantFile);
  if (targetFiles.length === 0) {
    return null;
  }

  const cruiseTargets = resolveDependencyCruiserTargets(unit, targetFiles, index.repoPath);
  if (cruiseTargets.length === 0) {
    return null;
  }

  const cacheKey = `${normalizePath(index.repoPath)}::${cruiseTargets.join('|')}`;
  if (!dependencyCruiserCache.has(cacheKey)) {
    dependencyCruiserCache.set(cacheKey, (async () => {
      try {
        const dependencyCruiserBin = resolveDependencyCruiserBinary();
        const result = await execa(dependencyCruiserBin, [
          '--no-config',
          '--output-type',
          'json',
          '--exclude',
          '^(node_modules|dist|build|coverage|\\.next|\\.git|\\.codeowl)(/|$)',
          '--do-not-follow',
          '^(node_modules|dist|build|coverage|\\.next|\\.git|\\.codeowl)(/|$)',
          ...cruiseTargets,
        ], {
          cwd: index.repoPath,
        });

        return parseDependencyCruiserReport(result.stdout, index);
      } catch (err) {
        const message = (err as Error).message;
        log(`  Warning: dependency-cruiser failed for ${unit.name}: ${message}`);
        return {
          ...createEmptyDependencyCruiserInsights(),
          warnings: [`Dependency-cruiser failed for ${unit.name}: ${message}`],
        };
      }
    })());
  }

  return dependencyCruiserCache.get(cacheKey)!;
}

function resolveDependencyCruiserBinary(): string {
  for (const candidate of DEPENDENCY_CRUISER_BIN_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return 'depcruise';
}

function isDependencyCruiserRelevantFile(file: RepoFile): boolean {
  return /\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(file.relativePath);
}

function resolveDependencyCruiserTargets(
  unit: ArchitecturalUnit,
  selectedFiles: RepoFile[],
  repoPath: string,
): string[] {
  if (unit.dirPath !== '.' && !unit.dirPath.includes('#')) {
    const absolutePath = path.join(repoPath, unit.dirPath);
    if (fs.existsSync(absolutePath)) {
      return [normalizePath(unit.dirPath)];
    }
  }

  return uniqueStrings(selectedFiles.map(file => normalizePath(file.relativePath)));
}

function parseDependencyCruiserReport(
  rawOutput: string,
  index: RepoIndex,
): DependencyCruiserInsights {
  const report = JSON.parse(rawOutput) as DependencyCruiserReport;
  const fileByPath = new Map(index.files.map(file => [normalizePath(file.relativePath), file]));
  const reachableFiles = new Map<string, RepoFile>();
  const importEdges: DependencyCruiserEdge[] = [];
  const npmPackages = new Set<string>();
  const integrationNames = new Set<string>();

  for (const moduleRecord of report.modules || []) {
    const sourcePath = normalizeDependencyCruiserPath(moduleRecord.source, index.repoPath);
    const sourceFile = fileByPath.get(sourcePath);
    if (sourceFile) {
      reachableFiles.set(sourceFile.relativePath, sourceFile);
    }

    for (const dependency of moduleRecord.dependencies || []) {
      if (dependency.module && dependency.dependencyTypes?.includes('npm')) {
        const packageName = normalizePackageName(dependency.module);
        npmPackages.add(packageName);
        const resource = inferResourceFromPackageName(packageName);
        if (resource) {
          integrationNames.add(resource);
        }
      }

      if (!sourceFile) continue;

      const targetPath = normalizeDependencyCruiserPath(dependency.resolved || dependency.module || '', index.repoPath);
      const targetFile = fileByPath.get(targetPath);
      if (!targetFile) continue;

      reachableFiles.set(targetFile.relativePath, targetFile);
      importEdges.push({
        sourcePath: sourceFile.relativePath,
        targetPath: targetFile.relativePath,
      });
    }
  }

  return {
    reachableFiles: dedupeRepoFiles([...reachableFiles.values()]),
    importEdges: dedupeDependencyCruiserEdges(importEdges),
    npmPackages: [...npmPackages].sort((left, right) => left.localeCompare(right)),
    integrations: buildIntegrationHints({
      name: 'Dependency Cruiser',
      dirPath: '.',
      files: [],
      dependencyHints: [],
      analysisHints: [],
      capabilityHints: [],
      integrationHints: [],
      submoduleHints: [],
      entityHints: [],
      interfaceHints: [],
    }, [...integrationNames]),
    warnings: [],
  };
}

function normalizeDependencyCruiserPath(value: string, repoPath: string): string {
  if (!value) return '';
  const normalized = normalizePath(value);
  if (/^[A-Za-z]:\//.test(normalized)) {
    return normalizePath(path.relative(repoPath, normalized));
  }
  return normalized;
}

function normalizePackageName(value: string): string {
  if (value.startsWith('@')) {
    const [scope, name] = value.split('/');
    return name ? `${scope}/${name}` : value;
  }
  return value.split('/')[0];
}

function selectDeterministicSeedFiles(
  unit: ArchitecturalUnit,
  options: { includeCrossUnitFiles?: boolean } = {},
): RepoFile[] {
  const selected = new Map<string, RepoFile>();

  for (const file of unit.files) {
    if (!isArchitectureRelevantFile(file)) continue;
    if (scoreFileForAnalysis(file, unit) < 8) continue;
    selected.set(file.relativePath, file);
  }

  if (options.includeCrossUnitFiles !== false) {
    for (const file of unit.files) {
      const relative = normalizePath(file.relativePath);
      if (/^(package\.json|pnpm-workspace\.ya?ml|turbo\.json|docker-compose.*\.ya?ml|compose.*\.ya?ml|\.env(\.|$)|k8s\/|helm\/|terraform\/|infra\/)/i.test(relative)) {
        selected.set(file.relativePath, file);
      }
    }
  }

  return sortFilesForAnalysis([...selected.values()], unit);
}

function sortFilesForAnalysis(files: RepoFile[], unit: ArchitecturalUnit): RepoFile[] {
  return [...dedupeRepoFiles(files)].sort((left, right) => {
    const scoreDelta = scoreFileForAnalysis(right, unit) - scoreFileForAnalysis(left, unit);
    if (scoreDelta !== 0) return scoreDelta;
    return left.relativePath.localeCompare(right.relativePath);
  });
}

function dedupeRepoFiles(files: RepoFile[]): RepoFile[] {
  const seen = new Set<string>();
  const result: RepoFile[] = [];

  for (const file of files) {
    if (!file || !file.relativePath || seen.has(file.relativePath)) continue;
    seen.add(file.relativePath);
    result.push(file);
  }

  return result;
}

function buildUnitAnalysisHints(unit: ArchitecturalUnit): string[] {
  const hints = [...unit.analysisHints];
  if (unit.kindHint) hints.push(`Suggested kind: ${unit.kindHint}`);
  if (unit.dependencyHints.length > 0) hints.push(`Known dependencies or integrations: ${unit.dependencyHints.join(', ')}`);
  if (unit.capabilityHints.length > 0) hints.push(`Likely capabilities: ${unit.capabilityHints.join(', ')}`);
  if (unit.submoduleHints.length > 0) hints.push(`Likely submodules: ${unit.submoduleHints.join(', ')}`);
  if (unit.entityHints.length > 0) hints.push(`Likely data models: ${unit.entityHints.map(entity => entity.name).join(', ')}`);
  if (unit.interfaceHints.length > 0) hints.push(`Likely public interfaces: ${unit.interfaceHints.map(api => `${api.type}:${api.name}`).join(', ')}`);
  return uniqueStrings(hints);
}

async function summarizeSelectedFiles(
  unit: ArchitecturalUnit,
  files: RepoFile[],
  model: string,
  aiContext: AIRuntimeContext,
  log: (msg: string) => void,
): Promise<FileSummary[]> {
  const summaries: FileSummary[] = [];
  let fileIndex = 0;

  for (const file of files) {
    fileIndex += 1;
    if (fileIndex === 1 || fileIndex === files.length || fileIndex % 10 === 0) {
      log(`  Summarizing files for ${unit.name}: ${fileIndex}/${files.length}`);
    }

    if (!aiContext.enabled || !aiContext.apiKey || !aiContext.runtime) {
      summaries.push(buildStaticFileSummary(unit, file));
      continue;
    }

    const content = readFileContent(file.absolutePath, 6000);
    if (!content) {
      summaries.push(buildStaticFileSummary(unit, file));
      continue;
    }

    try {
      const result = await runSystemDesignAIRuntime(
        aiContext,
        {
          systemPrompt: buildFileSummarySystemPrompt(),
          userMessage: buildFileSummaryUserMessage(unit.name, file.relativePath, content, buildFileAnalysisHints(unit, file)),
          model,
          apiKey: aiContext.apiKey,
          maxTokens: 2048,
        },
        fileSummarySchema,
        log,
      );
      if (!result) {
        summaries.push(buildStaticFileSummary(unit, file));
        continue;
      }
      const summary = fileSummarySchema.parse(result.data);
      summaries.push({
        ...summary,
        filePath: file.relativePath,
        integrations: dedupeIntegrations(summary.integrations),
        dependencies: uniqueStrings(summary.dependencies),
        submodules: uniqueStrings(summary.submodules),
        capabilities: uniqueStrings(summary.capabilities),
      });
    } catch (err) {
      if (handleSystemDesignAIError(aiContext, err, log, `file summary for ${file.relativePath}`)) {
        summaries.push(buildStaticFileSummary(unit, file));
        continue;
      }
      log(`  Warning: file summary failed for ${file.relativePath}: ${(err as Error).message}`);
      summaries.push(buildStaticFileSummary(unit, file));
    }
  }

  return summaries;
}

function buildFileAnalysisHints(unit: ArchitecturalUnit, file: RepoFile): string[] {
  const hints = [`Unit kind hint: ${unit.kindHint || 'unknown'}`];
  const relative = stripUnitPrefix(file.relativePath, unit.dirPath).toLowerCase();

  if (/(controller|route|handler|pages\/api|app\/api)/.test(relative)) hints.push('This file may define HTTP/controller interfaces.');
  if (/(components|page|layout|screen|view|app\/)/.test(relative)) hints.push('This file may define frontend UI or user-facing flows.');
  if (/(worker|job|queue|scheduler|cron)/.test(relative)) hints.push('This file may define background or scheduled processing.');
  if (/(schema|model|entity|table|db|data)/.test(relative)) hints.push('This file may define data models or persistence details.');
  if (/(env|config|terraform|compose|docker|k8s|helm)/.test(relative)) hints.push('This file may define infrastructure, deployment, or integration configuration.');

  return hints;
}

function buildStaticFileSummary(unit: ArchitecturalUnit, file: RepoFile): FileSummary {
  const relative = stripUnitPrefix(file.relativePath, unit.dirPath).toLowerCase();
  const route = normalizedRouteFromPath(file.relativePath);
  const interfaces = dedupeInterfaces([
    ...extractPublicInterfacesFromFile(file),
    ...(route ? [{ type: 'http' as const, name: route, description: 'Detected API route from file path' }] : []),
    ...(/(controller|handler)/.test(relative)
      ? [{ type: 'http' as const, name: file.relativePath, description: 'Controller or handler file' }]
      : []),
  ]);
  const integrations = INTEGRATION_RESOURCES
    .filter(resource => fileContainsResourceEvidence(file, resource))
    .map(resource => ({
      name: resource.name,
      description: integrationDescriptionFor(resource),
      internal: false,
      category: resource.category,
    }));
  const outboundCalls = extractOutboundHttpCalls([file]);
  const entities = detectEntityHints([file]);
  const submodules = relative.split('/').filter(segment => SUBMODULE_SEGMENTS.has(segment)).map(normalizeSubmoduleLabel);
  const capabilities = route ? [capabilityFromInterface(route, [file])] : [];

  return {
    filePath: file.relativePath,
    summary: summarizeFileRole(unit, file),
    interfaces,
    integrations: dedupeIntegrations(integrations),
    dependencies: outboundCalls
      .filter(call => !call.host && Boolean(call.path))
      .map(call => call.path),
    entities,
    submodules: uniqueStrings(submodules.filter(Boolean)),
    capabilities: uniqueStrings(capabilities.filter(Boolean)),
    importance: Math.max(1, Math.min(10, Math.ceil(scoreFileForAnalysis(file, unit) / 4))),
  };
}

function summarizeFileRole(unit: ArchitecturalUnit, file: RepoFile): string {
  const relative = stripUnitPrefix(file.relativePath, unit.dirPath).toLowerCase();
  if (/package\.json$/.test(relative)) return `Package manifest for ${unit.name} that declares dependencies and execution metadata.`;
  if (/(docker|compose|terraform|k8s|helm|deployment|infra|\.env)/.test(relative)) return `Infrastructure or runtime configuration that influences how ${unit.name} is deployed and connected.`;
  if (/(controller|route|handler|pages\/api|app\/api)/.test(relative)) return `API surface or request-handling file for ${unit.name}.`;
  if (/(worker|job|queue|scheduler|cron)/.test(relative)) return `Background-processing file for ${unit.name}.`;
  if (/(components|page|layout|screen|view)/.test(relative)) return `Frontend UI file contributing user-facing flows in ${unit.name}.`;
  if (/(schema|model|entity|table|db|data)/.test(relative)) return `Data-model or persistence-related file used by ${unit.name}.`;
  return `Supporting source or configuration file within ${unit.name}.`;
}

type ExtractedHttpCall = {
  method?: string;
  path: string;
  host?: string;
};

function extractPublicInterfacesFromFiles(files: RepoFile[]): ArchitecturalUnit['interfaceHints'] {
  return dedupeInterfaces(files.flatMap(file => extractPublicInterfacesFromFile(file)));
}

function extractPublicInterfacesFromFile(file: RepoFile): ArchitecturalUnit['interfaceHints'] {
  const normalizedPath = normalizePath(file.relativePath).toLowerCase();
  if (/controller\.cs$/.test(normalizedPath)) {
    return extractAspNetControllerInterfaces(file);
  }

  const route = normalizedRouteFromPath(file.relativePath);
  return route
    ? [{ type: 'http', name: route, description: 'Detected API route from file path' }]
    : [];
}

function extractAspNetControllerInterfaces(file: RepoFile): ArchitecturalUnit['interfaceHints'] {
  const content = readFileSafe(file.absolutePath);
  if (!content) return [];

  const classDeclaration = content.match(/public\s+class\s+([A-Za-z0-9_]+Controller)\b/);
  const controllerName = classDeclaration?.[1] || path.basename(file.relativePath, path.extname(file.relativePath));
  const controllerSegment = controllerName.replace(/Controller$/, '');
  const classAttributes = typeof classDeclaration?.index === 'number'
    ? content.slice(Math.max(0, classDeclaration.index - 500), classDeclaration.index)
    : '';
  const baseRoute = resolveAspNetRouteTemplate(extractRouteAttribute(classAttributes), controllerSegment);
  const methodInterfaces: ArchitecturalUnit['interfaceHints'] = [];
  const methodPattern = /((?:\s*\[[^\]]+\]\s*)+)public\s+(?:async\s+)?(?:Task(?:<[^>]+>)?|ActionResult(?:<[^>]+>)?|IActionResult|IEnumerable<[^>]+>|[A-Za-z0-9_<>,\[\]\?]+)\s+([A-Za-z0-9_]+)\s*\(/g;

  for (const match of content.matchAll(methodPattern)) {
    const attributes = match[1];
    const httpMethodMatch = attributes.match(/\[Http(Get|Post|Put|Patch|Delete)(?:\("([^"]*)"\))?\]/i);
    if (!httpMethodMatch) continue;

    const method = httpMethodMatch[1].toUpperCase();
    const httpRoute = httpMethodMatch[2] || '';
    const explicitRoute = extractRouteAttribute(attributes);
    const routePath = buildAspNetRoutePath(baseRoute, explicitRoute || httpRoute, controllerSegment);
    methodInterfaces.push({
      type: 'http',
      name: `${method} ${routePath}`,
      description: `ASP.NET controller action in ${controllerName}`,
    });
  }

  if (methodInterfaces.length > 0) {
    return dedupeInterfaces(methodInterfaces);
  }

  const fallbackRoute = buildAspNetRoutePath(baseRoute, '', controllerSegment);
  return [{
    type: 'http',
    name: fallbackRoute,
    description: `ASP.NET controller in ${controllerName}`,
  }];
}

function extractRouteAttribute(attributes: string): string {
  const match = attributes.match(/\[Route\("([^"]+)"\)\]/i);
  return match?.[1] || '';
}

function resolveAspNetRouteTemplate(template: string, controllerSegment: string): string {
  if (!template) {
    return `/${controllerSegment}`;
  }

  return normalizeHttpPath(
    template
      .replace(/\[controller\]/ig, controllerSegment)
      .replace(/\[action\]/ig, '')
      .replace(/\/+/g, '/'),
  );
}

function buildAspNetRoutePath(baseRoute: string, routeFragment: string, controllerSegment: string): string {
  const resolvedBase = baseRoute || `/${controllerSegment}`;
  const resolvedFragment = routeFragment
    .replace(/\[controller\]/ig, controllerSegment)
    .replace(/\[action\]/ig, '')
    .trim();

  if (!resolvedFragment) {
    return normalizeHttpPath(resolvedBase);
  }

  if (/^\//.test(resolvedFragment)) {
    return normalizeHttpPath(resolvedFragment);
  }

  return normalizeHttpPath(`${resolvedBase}/${resolvedFragment}`);
}

function extractOutboundHttpCalls(files: RepoFile[]): ExtractedHttpCall[] {
  return files.flatMap(file => extractOutboundHttpCallsFromFile(file));
}

function extractOutboundHttpCallsFromFile(file: RepoFile): ExtractedHttpCall[] {
  if (!/\.(ts|tsx|js|jsx|cs)$/i.test(file.relativePath)) {
    return [];
  }

  const content = readFileSafe(file.absolutePath);
  if (!content) return [];

  const variableExpressions = new Map<string, string>();
  const assignmentPattern = /(?:const|let|var|private|public|protected)?\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^;\n]+);/g;
  for (const match of content.matchAll(assignmentPattern)) {
    const variableName = match[1];
    const expression = match[2].trim();
    variableExpressions.set(variableName, expression);
    variableExpressions.set(`this.${variableName}`, expression);
  }

  const calls: ExtractedHttpCall[] = [];
  const callPatterns = [
    /\.(get|post|put|patch|delete)\s*(?:<[^>]+>)?\(\s*([^,\)\r\n]+)/gi,
    /\bfetch\(\s*([^,\)\r\n]+)/gi,
    /\baxios\.(get|post|put|patch|delete)\(\s*([^,\)\r\n]+)/gi,
  ];

  for (const pattern of callPatterns) {
    for (const match of content.matchAll(pattern)) {
      const hasMethod = Boolean(match[2]);
      const method = hasMethod ? match[1]?.toUpperCase() : 'GET';
      const expression = hasMethod ? match[2] : match[1];
      const resolved = resolveHttpExpression(expression, variableExpressions);
      for (const value of resolved) {
        const normalized = normalizeHttpCallValue(value);
        if (!normalized) continue;
        calls.push({
          method,
          path: normalized.path,
          host: normalized.host,
        });
      }
    }
  }

  return dedupeHttpCalls(calls);
}

function resolveHttpExpression(
  expression: string,
  variableExpressions: Map<string, string>,
  visiting = new Set<string>(),
): string[] {
  const trimmed = expression.trim();
  if (!trimmed) return [];

  const stringLiteral = extractStringLiteral(trimmed);
  if (stringLiteral !== undefined) {
    return [stringLiteral];
  }

  const directVariable = trimmed.replace(/\?\.?/g, '.');
  if (variableExpressions.has(directVariable)) {
    if (visiting.has(directVariable)) return [];
    visiting.add(directVariable);
    const resolved = resolveHttpExpression(variableExpressions.get(directVariable) || '', variableExpressions, visiting);
    visiting.delete(directVariable);
    return resolved;
  }

  if (trimmed.includes('+')) {
    const parts = trimmed.split('+').map(part => part.trim()).filter(Boolean);
    const resolvedParts = parts.map(part => resolveHttpExpression(part, variableExpressions, visiting));
    const combined = resolvedParts
      .map(values => values[0] || '')
      .join('');
    return combined ? [combined] : [];
  }

  return [];
}

function extractStringLiteral(value: string): string | undefined {
  const singleQuoted = value.match(/^'([^']*)'$/);
  if (singleQuoted) return singleQuoted[1];
  const doubleQuoted = value.match(/^"([^"]*)"$/);
  if (doubleQuoted) return doubleQuoted[1];
  const template = value.match(/^`([^`]*)`$/);
  if (template) return template[1].replace(/\$\{[^}]+\}/g, '');
  return undefined;
}

function normalizeHttpCallValue(value: string): { path: string; host?: string } | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      return {
        host: url.host.toLowerCase(),
        path: normalizeHttpPath(url.pathname),
      };
    } catch {
      return null;
    }
  }

  const withoutQuery = trimmed.split('?')[0];
  const normalizedPath = normalizeHttpPath(withoutQuery);
  return normalizedPath ? { path: normalizedPath } : null;
}

function normalizeHttpPath(value: string): string {
  const withoutQuery = value
    .replace(/\$\{[^}]+\}/g, '')
    .replace(/\[controller\]/ig, '')
    .split('?')[0]
    .trim();
  const normalized = withoutQuery
    .replace(/\\/g, '/')
    .replace(/^https?:\/\/[^/]+/i, '')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '');
  if (!normalized || normalized === '.') return '';
  return normalized.startsWith('/') ? normalized.toLowerCase() : `/${normalized.toLowerCase()}`;
}

function stripHttpMethodPrefix(value: string): string {
  return value.replace(/^(GET|POST|PUT|PATCH|DELETE)\s+/i, '');
}

function normalizeHttpMethodPrefix(value: string): string | undefined {
  const match = value.match(/^(GET|POST|PUT|PATCH|DELETE)\s+/i);
  return match?.[1]?.toUpperCase();
}

function dedupeHttpCalls(calls: ExtractedHttpCall[]): ExtractedHttpCall[] {
  const seen = new Set<string>();
  const result: ExtractedHttpCall[] = [];
  for (const call of calls) {
    const key = `${call.method || ''}:${call.host || ''}:${call.path}`;
    if (!call.path || seen.has(key)) continue;
    seen.add(key);
    result.push(call);
  }
  return result;
}

function findBestServiceForHttpCall(
  call: ExtractedHttpCall,
  serviceRoutes: Array<{
    service: ServiceDesignDoc;
    routes: Array<{ method?: string; path: string; raw: string }>;
  }>,
  sourceServiceId: string,
): ServiceDesignDoc | undefined {
  let bestMatch: { service: ServiceDesignDoc; score: number } | undefined;

  for (const candidate of serviceRoutes) {
    if (candidate.service.serviceId === sourceServiceId) continue;
    for (const route of candidate.routes) {
      const score = scoreHttpRouteMatch(call, route);
      if (!score) continue;
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { service: candidate.service, score };
      }
    }
  }

  return bestMatch?.service;
}

function scoreHttpRouteMatch(
  call: ExtractedHttpCall,
  route: { method?: string; path: string },
): number {
  if (!call.path || !route.path) return 0;
  if (call.method && route.method && call.method !== route.method) return 0;

  const callPath = normalizeHttpPath(call.path);
  const routePath = normalizeHttpPath(route.path);
  if (!callPath || !routePath) return 0;

  if (callPath === routePath) return 100;
  if (routePath.endsWith(callPath)) return 80 + callPath.length;
  if (callPath.endsWith(routePath)) return 70 + routePath.length;

  const callSegments = callPath.split('/').filter(Boolean);
  const routeSegments = routePath.split('/').filter(Boolean);
  let sharedSuffix = 0;

  while (
    sharedSuffix < callSegments.length
    && sharedSuffix < routeSegments.length
    && callSegments[callSegments.length - 1 - sharedSuffix] === routeSegments[routeSegments.length - 1 - sharedSuffix]
  ) {
    sharedSuffix += 1;
  }

  return sharedSuffix >= 2 ? sharedSuffix * 20 : 0;
}

function isLikelyInternalHost(host: string): boolean {
  return /^(localhost|127\.0\.0\.1|0\.0\.0\.0)/i.test(host)
    || /\.local$/i.test(host)
    || /\.internal$/i.test(host);
}

async function synthesizeServiceFromFileSummaries(
  unit: ArchitecturalUnit,
  fileSummaries: FileSummary[],
  model: string,
  aiContext: AIRuntimeContext,
  log: (msg: string) => void,
): Promise<ServiceDesignDoc> {
  const staticDoc = buildServiceDocFromFileSummaries(unit, fileSummaries);

  if (!aiContext.enabled || !aiContext.apiKey || !aiContext.runtime || fileSummaries.length === 0) {
    return staticDoc;
  }

  try {
    const result = await runSystemDesignAIRuntime(
      aiContext,
      {
        systemPrompt: buildServiceSynthesisFromFilesSystemPrompt(),
        userMessage: buildServiceSynthesisFromFilesUserMessage(
          unit.name,
          buildUnitAnalysisHints(unit),
          formatFileSummariesForSynthesis(fileSummaries),
        ),
        model,
        apiKey: aiContext.apiKey,
        maxTokens: 4096,
      },
      serviceDesignDocSchema,
      log,
    );
    if (!result) {
      return staticDoc;
    }

    return mergeServiceDocs(staticDoc, serviceDesignDocSchema.parse(result.data) as ServiceDesignDoc);
  } catch (err) {
    if (handleSystemDesignAIError(aiContext, err, log, `service synthesis for ${unit.name}`)) {
      return staticDoc;
    }
    log(`  Warning: service synthesis failed for ${unit.name}: ${(err as Error).message}`);
    return staticDoc;
  }
}

function buildServiceDocFromFileSummaries(
  unit: ArchitecturalUnit,
  fileSummaries: FileSummary[],
): ServiceDesignDoc {
  const responsibilities = dedupeStrings([
    ...buildResponsibilities(unit),
    ...fileSummaries
      .filter(summary => summary.importance >= 6)
      .map(summary => summary.summary.replace(/\s+/g, ' ').trim())
      .slice(0, 6),
  ]).slice(0, 8);
  const integrations = dedupeIntegrations([
    ...unit.integrationHints,
    ...fileSummaries.flatMap(summary => summary.integrations),
  ]);
  const dependencies = uniqueStrings([
    ...unit.dependencyHints,
    ...fileSummaries.flatMap(summary => summary.dependencies),
  ]);
  const entities = dedupeEntities([
    ...unit.entityHints,
    ...fileSummaries.flatMap(summary => summary.entities),
  ]);
  const submodules = uniqueStrings([
    ...unit.submoduleHints,
    ...fileSummaries.flatMap(summary => summary.submodules),
  ]).slice(0, 20);
  const publicInterfaces = dedupeInterfaces([
    ...unit.interfaceHints,
    ...fileSummaries.flatMap(summary => summary.interfaces),
  ]);
  const capabilities = dedupeStrings([
    ...unit.capabilityHints,
    ...fileSummaries.flatMap(summary => summary.capabilities),
  ]).slice(0, 20);
  const importance = fileSummaries.length === 0
    ? 0
    : fileSummaries.reduce((sum, summary) => sum + summary.importance, 0) / fileSummaries.length;

  return ensureServiceDoc(unit, {
    ...buildStaticServiceDoc(unit, fileSummaries.map(summary => summary.filePath)),
    responsibilities,
    integrations,
    dependencies,
    entities,
    submodules,
    publicInterfaces,
    capabilities,
    complexityScore: Math.max(1, Math.min(10, Math.round(Math.max(estimateComplexity(unit.files, unit.kindHint), importance)))),
    confidence: Math.min(0.95, 0.45 + Math.min(fileSummaries.length, 40) / 100),
  });
}

function mergeServiceDocs(base: ServiceDesignDoc, override: ServiceDesignDoc): ServiceDesignDoc {
  return {
    ...base,
    ...override,
    responsibilities: dedupeStrings([...(base.responsibilities || []), ...(override.responsibilities || [])]).slice(0, 12),
    capabilities: dedupeStrings([...(base.capabilities || []), ...(override.capabilities || [])]).slice(0, 20),
    publicInterfaces: dedupeInterfaces([...(base.publicInterfaces || []), ...(override.publicInterfaces || [])]),
    integrations: dedupeIntegrations([...(base.integrations || []), ...(override.integrations || [])]),
    dependencies: uniqueStrings([...(base.dependencies || []), ...(override.dependencies || [])]),
    entities: dedupeEntities([...(base.entities || []), ...(override.entities || [])]),
    submodules: uniqueStrings([...(base.submodules || []), ...(override.submodules || [])]),
    evidence: {
      filePaths: uniqueStrings([...(base.evidence?.filePaths || []), ...(override.evidence?.filePaths || [])]),
      reasons: uniqueStrings([...(base.evidence?.reasons || []), ...(override.evidence?.reasons || [])]),
    },
    discoverySources: uniqueStrings([...(base.discoverySources || []), ...(override.discoverySources || [])]),
    gaps: uniqueStrings([...(base.gaps || []), ...(override.gaps || [])]),
    conflicts: uniqueStrings([...(base.conflicts || []), ...(override.conflicts || [])]),
    confidence: Math.max(base.confidence || 0, override.confidence || 0),
  };
}

function enrichServiceDocFromFileSummaries(
  unit: ArchitecturalUnit,
  doc: ServiceDesignDoc,
  selection: RelevantFileSelectionResult,
  fileSummaries: FileSummary[],
): ServiceDesignDoc {
  const merged = mergeServiceDocs(buildServiceDocFromFileSummaries(unit, fileSummaries), doc);
  const gaps = [...merged.gaps, ...selection.gaps, ...(selection.dependencyCruiser?.warnings || [])];

  if (unit.kindHint === 'app' && !fileSummaries.some(summary => /(components?|page|layout|screen|view|frontend|ui|main\.ts|app\.module|app\.component)/i.test(summary.filePath))) {
    gaps.push('Frontend surface not confidently identified from selected files.');
  }
  if ((unit.kindHint === 'gateway' || unit.kindHint === 'service') && merged.publicInterfaces.length === 0) {
    gaps.push('No public interfaces were confidently identified for this service.');
  }
  if (merged.integrations.length === 0 && unit.integrationHints.length > 0) {
    gaps.push('Static integration hints exist, but file analysis did not confirm them directly.');
  }

  return ensureServiceDoc(unit, {
    ...merged,
    kind: unit.kindHint === 'resource' ? 'resource' : merged.kind,
    resourceCategory: merged.resourceCategory || unit.resourceCategory,
    purpose: !merged.purpose || /service\/module detected from/i.test(merged.purpose)
      ? buildFallbackPurpose(unit)
      : merged.purpose,
    integrations: dedupeIntegrations([
      ...merged.integrations,
      ...(selection.dependencyCruiser?.integrations || []),
    ]),
    dependencies: uniqueStrings(merged.dependencies),
    evidence: {
      filePaths: uniqueStrings(selection.selectedFiles.map(file => file.relativePath)),
      reasons: uniqueStrings([
        ...selection.reasons,
        ...fileSummaries.slice(0, 40).map(summary => `${summary.filePath}: ${summary.summary}`),
      ]).slice(0, 80),
    },
    discoverySources: uniqueStrings([
      ...unit.analysisHints,
      ...selection.reasons,
    ]),
    confidence: Math.max(
      merged.confidence,
      Math.min(
        0.98,
        0.4
          + Math.min(selection.selectedFiles.length, 80) / 160
          + Math.min(fileSummaries.length, 80) / 160
          + (selection.confidence * 0.15),
      ),
    ),
    gaps: uniqueStrings(gaps),
  });
}

function formatFileSummariesForSynthesis(fileSummaries: FileSummary[]): string {
  return fileSummaries
    .map(summary => JSON.stringify(summary, null, 2))
    .join('\n\n---\n\n');
}

function chunkFiles(files: RepoFile[], chunkSize: number): RepoFile[][] {
  const chunks: RepoFile[][] = [];
  for (let index = 0; index < files.length; index += chunkSize) {
    chunks.push(files.slice(index, index + chunkSize));
  }
  return chunks;
}

async function runSystemDesignAIRuntime<T>(
  aiContext: AIRuntimeContext,
  options: Parameters<IRuntime['run']>[0],
  schema: z.ZodSchema<T>,
  log: (msg: string) => void,
): Promise<RunResult<T> | null> {
  if (!aiContext.enabled || !aiContext.apiKey || !aiContext.runtime) {
    return null;
  }

  try {
    return await aiContext.runtime.run(options, schema);
  } catch (err) {
    if (handleSystemDesignAIError(aiContext, err, log)) {
      return null;
    }
    throw err;
  }
}

function handleSystemDesignAIError(
  aiContext: AIRuntimeContext,
  err: unknown,
  log: (msg: string) => void,
  scope?: string,
): boolean {
  const message = (err as Error).message || String(err);
  if (!isAuthenticationFailure(message)) {
    return false;
  }

  if (!aiContext.authFailureMessage) {
    aiContext.authFailureMessage = message;
    log(`AI authentication failed${scope ? ` during ${scope}` : ''}; continuing with static system-design analysis for the remaining steps.`);
  }

  aiContext.enabled = false;
  aiContext.runtime = null;
  return true;
}

function isAuthenticationFailure(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('401')
    || normalized.includes('unauthorized')
    || normalized.includes('authorization')
    || normalized.includes('invalid api key')
    || normalized.includes('api secret key')
    || normalized.includes('login fail');
}

async function resolveSystemDesignRuntime(
  dependencies: SystemDesignDependencies,
  log: (msg: string) => void,
): Promise<IRuntime> {
  if (dependencies === defaultDependencies) {
    if (process.env.CODEOWL_RUNTIME === 'mock') {
      log('Using mock runtime for system-design analysis.');
      return createRuntime('mock');
    }

    if (process.env.CODEOWL_SYSTEM_DESIGN_RUNTIME === 'opencode-cli') {
      try {
        const runtime = await createRuntime('opencode-cli');
        log('Using OpenCode CLI runtime for deeper system-design research.');
        return runtime;
      } catch (err) {
        log(`OpenCode CLI unavailable, falling back to direct runtime: ${(err as Error).message}`);
      }
    } else {
      log('Using direct AI runtime for system-design analysis.');
    }

    try {
      return await createRuntime('direct');
    } catch (err) {
      log(`Direct runtime unavailable, falling back to default runtime: ${(err as Error).message}`);
      const runtime = await createRuntime('opencode-cli');
      log('Using OpenCode CLI runtime for deeper system-design research.');
      return runtime;
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
  if (/(^|[\s./_-])(frontend|web|client|ui|mobile|admin|dashboard)(?=$|[\s./_-])/.test(haystack)) return 'app';
  if (/(^|[\s./_-])(worker|workers|job|jobs|scheduler|cron|consumer|queue)(?=$|[\s./_-])/.test(haystack)) return 'worker';
  if (/(^|[\s./_-])(gateway|proxy|bff|edge)(?=$|[\s./_-])/.test(haystack)) return 'gateway';
  if (/(^|[\s./_-])(shared|common|lib|libs|util|utils)(?=$|[\s./_-])/.test(haystack)) return 'library';
  if (RESOURCE_NAME_PATTERN.test(haystack)) return 'resource';
  if (/(^|[\s./_-])(module|feature|domain)(?=$|[\s./_-])/.test(haystack)) return 'module';
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

function uniqueStrings(values: string[]): string[] {
  return dedupeStrings(values);
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
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
    const key = buildIntegrationIdentityKey(integration);
    if (!integration.name || seen.has(key)) continue;
    seen.add(key);
    result.push({
      ...integration,
      description: integration.description.slice(0, 200),
    });
  }
  return result;
}

function buildIntegrationIdentityKey(integration: { name: string; internal: boolean; category?: ResourceCategory; instanceKey?: string }): string {
  return [
    normalizeToken(integration.name),
    integration.internal ? 'internal' : 'external',
    integration.category || '',
    normalizeToken(integration.instanceKey || ''),
  ].join(':');
}

function buildIntegrationServices(services: ServiceDesignDoc[]): ServiceDesignDoc[] {
  const existingResourceKeys = new Set(
    services
      .filter(service => service.kind === 'resource')
      .map(service => normalizeToken(service.name))
      .filter(Boolean),
  );
  const integrations = new Map<string, {
    integration: ServiceDesignDoc['integrations'][number];
    consumers: Set<string>;
    evidence: Set<string>;
    confidence: number;
  }>();

  for (const service of services) {
    for (const integration of service.integrations) {
      if (integration.internal) continue;
      const key = buildIntegrationIdentityKey(integration);
      if (!integrations.has(key)) {
        integrations.set(key, {
          integration,
          consumers: new Set<string>(),
          evidence: new Set<string>(),
          confidence: 0,
        });
      }

      const current = integrations.get(key)!;
      current.consumers.add(service.name);
      current.confidence = Math.max(current.confidence, service.confidence);
      for (const filePath of service.evidence.filePaths) {
        current.evidence.add(filePath);
      }
      if (integration.description.length > current.integration.description.length) {
        current.integration = integration;
      }
    }
  }

  const resources: ServiceDesignDoc[] = [];

  for (const { integration, consumers, evidence, confidence } of integrations.values()) {
    if (existingResourceKeys.has(normalizeToken(integration.name))) continue;
    const serviceName = integration.instanceKey
      ? `${humanizeName(integration.name)} (${integration.instanceKey})`
      : humanizeName(integration.name);

    resources.push({
      serviceId: buildIntegrationServiceId(integration),
      name: serviceName,
      kind: 'resource',
      resourceCategory: integration.category,
      purpose: integration.description,
      responsibilities: [
        consumers.size > 1
          ? `Provide ${humanizeName(integration.name).toLowerCase()} capability shared by ${consumers.size} services`
          : `Provide ${humanizeName(integration.name).toLowerCase()} capability to ${[...consumers][0]}`,
      ],
      capabilities: [],
      publicInterfaces: [],
      integrations: [],
      dependencies: [],
      entities: [],
      submodules: [],
      complexityScore: 1,
      risks: [],
      confidence: Math.max(0.55, confidence),
      evidence: {
        filePaths: [...evidence].slice(0, 60),
        reasons: [
          `Referenced by ${[...consumers].join(', ')}`,
          ...(integration.instanceKey ? [`Distinct instance key: ${integration.instanceKey}`] : []),
        ],
      },
      discoverySources: [`Synthesized from service integrations for ${[...consumers].join(', ')}`],
      gaps: [],
      conflicts: [],
    });
  }

  return resources.sort((left, right) => left.name.localeCompare(right.name));
}

function buildIntegrationServiceId(integration: { name: string; instanceKey?: string }): string {
  const base = normalizeToken(integration.name) || 'integration';
  const instance = normalizeToken(integration.instanceKey || '');
  return instance ? `integration-${base}-${instance}` : `integration-${base}`;
}

/** Detects architectural units from container directories (e.g. apps/, services/, modules/). */
function detectContainerDirUnits(repoPath: string, index: RepoIndex): ArchitecturalUnit[] {
  const units: ArchitecturalUnit[] = [];
  for (const pattern of CONTAINER_DIRS) {
    const patternDir = path.join(repoPath, pattern);
    let subdirs: string[];
    try {
      if (!fs.existsSync(patternDir)) continue;
      subdirs = fs.readdirSync(patternDir)
        .filter(e => {
          try {
            return fs.statSync(path.join(patternDir, e)).isDirectory();
          } catch {
            return false;
          }
        });
    } catch (err) {
      continue;
    }
    for (const subdir of subdirs) {
      const dirPath = `${pattern}/${subdir}`;
      const files = index.files.filter(f => f.relativePath.startsWith(dirPath + '/'));
      units.push({
        name: subdir,
        dirPath,
        files,
        kindHint: inferServiceKind(subdir, dirPath),
        dependencyHints: [],
        analysisHints: [`Detected from directory: ${dirPath}`],
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

/** Detects architectural units from well-known top-level service directories (e.g. frontend/, api/, worker/). */
function detectTopLevelServiceDirUnits(repoPath: string, index: RepoIndex): ArchitecturalUnit[] {
  const units: ArchitecturalUnit[] = [];
  for (const dirName of TOP_LEVEL_SERVICE_DIRS) {
    const fullPath = path.join(repoPath, dirName);
    try {
      if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) continue;
    } catch {
      continue;
    }
    const files = index.files.filter(f => f.relativePath.startsWith(dirName + '/'));
    units.push({
      name: dirName,
      dirPath: dirName,
      files,
      kindHint: inferServiceKind(dirName, dirName),
      dependencyHints: [],
      analysisHints: [`Detected from top-level directory: ${dirName}`],
      capabilityHints: [],
      integrationHints: [],
      submoduleHints: [],
      entityHints: [],
      interfaceHints: [],
    });
  }
  return units;
}

/**
 * Detects architectural units from subdirectories under src/ (or src/apps, src/services, etc.).
 * Skips src/ itself when a root application boundary is already detected to avoid duplication.
 */
function detectSrcDirUnits(repoPath: string, index: RepoIndex, hasRootApplicationBoundary: boolean): ArchitecturalUnit[] {
  const units: ArchitecturalUnit[] = [];
  for (const parentDir of COMMON_SERVICE_PREFIXES.filter(p => p.startsWith('src'))) {
    if (parentDir === 'src' && hasRootApplicationBoundary) continue;
    const fullPath = path.join(repoPath, parentDir);
    let subdirs: string[];
    try {
      if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) continue;
      subdirs = fs.readdirSync(fullPath)
        .filter(entry => {
          try {
            return fs.statSync(path.join(fullPath, entry)).isDirectory();
          } catch {
            return false;
          }
        });
    } catch {
      continue;
    }
    for (const subdir of subdirs) {
      const dirPath = `${parentDir}/${subdir}`;
      const files = index.files.filter(f => f.relativePath.startsWith(dirPath + '/'));
      if (files.length === 0) continue;

      const shouldInclude = subdirs.length > 1 || isServiceLikeDir(subdir) || RESOURCE_NAME_PATTERN.test(subdir);
      if (!shouldInclude) continue;

      units.push({
        name: subdir,
        dirPath,
        files,
        kindHint: inferServiceKind(subdir, dirPath),
        dependencyHints: [],
        analysisHints: [`Detected from source directory: ${dirPath}`],
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

/** Detects architectural units from package.json files in a monorepo workspace (npm/yarn/pnpm workspaces). */
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
          : inferPackageKind(unitName, dirPath, manifest, files),
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
          : inferPackagePurpose(unitName, dirPath, manifest, files),
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
  return inferPackageKind(solutionLabel, '.', manifest, files);
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

function inferPackageKind(
  name: string,
  dirPath: string,
  manifest?: Record<string, unknown>,
  files: RepoFile[] = [],
): ServiceKind {
  const dependencies = JSON.stringify(manifest?.dependencies || {});
  const devDependencies = JSON.stringify(manifest?.devDependencies || {});
  const haystack = `${name} ${dirPath} ${dependencies} ${devDependencies}`;

  if (isFrontendPackage(manifest, files, dirPath)) return 'app';
  if (/\"next\"/.test(haystack)) return 'app';
  if (/(^|[.\s/_-])worker(?=$|[.\s/_-])/.test(`${name} ${dirPath}`.toLowerCase())) return 'worker';
  return inferServiceKind(name, haystack);
}

function inferPackagePurpose(
  name: string,
  dirPath: string,
  manifest?: Record<string, unknown>,
  files: RepoFile[] = [],
): string | undefined {
  const manifestName = resolvePackageDisplayName(name, manifest);
  const kind = inferPackageKind(name, dirPath, manifest, files);
  if (kind === 'app') return `${manifestName} is an application package.`;
  if (kind === 'library') return `${manifestName} provides shared library capabilities.`;
  if (kind === 'worker') return `${manifestName} provides background processing or job execution.`;
  return undefined;
}

function resolvePackageDisplayName(name: string, manifest?: Record<string, unknown>): string {
  if (typeof manifest?.name !== 'string') return name;
  const manifestName = manifest.name.replace(/^@[^/]+\//, '');
  const normalized = manifestName.toLowerCase();
  if (
    GENERIC_APP_NAMES.has(normalized)
    || /(template|starter|boilerplate)/.test(normalized)
  ) {
    return name;
  }
  return manifestName;
}

function isFrontendPackage(
  manifest: Record<string, unknown> | undefined,
  files: RepoFile[],
  dirPath: string,
): boolean {
  const dependencies = collectManifestDependencies(manifest);
  if (
    dependencies.has('react')
    || dependencies.has('react-dom')
    || dependencies.has('@angular/core')
    || dependencies.has('@angular/common')
    || dependencies.has('vue')
    || dependencies.has('svelte')
    || dependencies.has('next')
  ) {
    return true;
  }

  return files.some(file => {
    const relative = stripUnitPrefix(file.relativePath, dirPath).toLowerCase();
    return /(^|\/)(src\/)?index\.tsx?$/.test(relative)
      || /(^|\/)(src\/)?app\.tsx?$/.test(relative)
      || /(^|\/)public\/index\.html$/.test(relative)
      || /(^|\/)angular\.json$/.test(relative)
      || /(^|\/)src\/main\.ts$/.test(relative)
      || /(^|\/)src\/app\/app\.module\.ts$/.test(relative);
  });
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
    && !/^\.(codeowl|claude)(\/|$)/.test(relativePath)
    && !/(^|\/)(mock-runtime(?:-log)?\.json|report\.json)$/.test(relativePath);
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
  if (/(^|\/)(index|main|app|server|client)\.(ts|tsx|js|jsx|py|go|rb|rs|java|kt|cs)$/.test(relative)) score += 10;
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

      const kindHint = inferComposeServiceKind(service.name, service.image, buildContext);
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

function inferComposeServiceKind(name: string, image?: string, buildContext?: string): ServiceKind {
  const haystack = `${name} ${image || ''} ${buildContext || ''}`.toLowerCase();
  if (!buildContext && /(mongo|mongo-express|seq|redis|postgres|postgresql|mysql|mariadb|rabbitmq|kafka|elasticsearch|opensearch|azurite|blob|storage)/.test(haystack)) {
    return 'resource';
  }
  return inferServiceKind(name, haystack);
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
  if (!resolved.startsWith(path.resolve(repoPath))) return undefined;
  const relative = normalizePath(path.relative(repoPath, resolved));
  return relative || '.';
}

function findFilesForServiceName(index: RepoIndex, serviceName: string): RepoFile[] {
  const normalized = normalizeToken(serviceName);
  const matches = index.files.filter(file => normalizeToken(file.relativePath).includes(normalized));
  return matches.length > 0 ? matches : [];
}

type ParsedComposeService = {
  name: string;
  image?: string;
  buildContext?: string;
  dependsOn: string[];
};

function parseComposeServices(filePath: string): ParsedComposeService[] {
  const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/);
  const services: ParsedComposeService[] = [];
  let inServices = false;
  let servicesIndent = -1;
  let current: ParsedComposeService | null = null;
  let currentIndent = -1;
  let inDependsOn = false;
  let dependsOnIndent = -1;

  const flush = () => {
    if (!current) return;
    current.dependsOn = uniqueStrings(current.dependsOn);
    services.push(current);
    current = null;
    currentIndent = -1;
    inDependsOn = false;
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
      flush();
      inServices = false;
      continue;
    }
    const serviceMatch = trimmed.match(/^([A-Za-z0-9_.-]+):\s*$/);
    if (serviceMatch && indent === servicesIndent + 2) {
      flush();
      current = { name: serviceMatch[1], dependsOn: [] };
      currentIndent = indent;
      continue;
    }
    if (!current) continue;
    if (indent <= currentIndent) {
      flush();
      continue;
    }
    const imageMatch = trimmed.match(/^image:\s*(.+)$/);
    if (imageMatch) {
      current.image = stripWrappingQuotes(imageMatch[1]);
      continue;
    }
    const buildMatch = trimmed.match(/^build:\s*(.+)$/);
    if (buildMatch) {
      current.buildContext = stripWrappingQuotes(buildMatch[1]);
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
        if (listMatch) current.dependsOn.push(listMatch[1]);
        if (mapMatch) current.dependsOn.push(mapMatch[1]);
      }
    }
  }

  flush();
  return services;
}

function stripWrappingQuotes(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '');
}

export function resolveSystemDesignTemplatePath(): string {
  for (const candidate of SYSTEM_DESIGN_TEMPLATE_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`System design template not found. Checked: ${SYSTEM_DESIGN_TEMPLATE_CANDIDATES.join(', ')}`);
}

function generateHTMLReport(outputDir: string, graph: import('../../../types/index').ArchitectureGraph): void {
  const templatePath = resolveSystemDesignTemplatePath();
  let template = fs.readFileSync(templatePath, 'utf-8');
  template = template.replace('__CODEOWL_DATA__', JSON.stringify(graph));
  writeText(path.join(outputDir, 'index.html'), template);
}
