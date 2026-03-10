import * as fs from 'fs';
import * as path from 'path';
import { RepoFile, RepoIndex, ServiceDesignDoc, ServiceKind, SystemDesignResult } from '../../../types/index';
import { buildRepoIndex, formatFilesForContext } from '../../../core/indexing/index';
import { getRuntime } from '../../../core/runtime/factory';
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

const CONTAINER_DIRS = ['packages', 'apps', 'services', 'modules', 'infra', 'infrastructure', 'deploy', 'deployment', 'docker', 'compose'];
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
  const apiKey = resolveApiKey(config);

  log('Indexing repository...');
  const index = await buildRepoIndex(repoPath, config);
  log(`Found ${index.totalFiles} files.`);

  log('Detecting services and modules...');
  const units = await detectArchitecturalUnits(repoPath, index);
  log(`Detected ${units.length} architectural unit(s): ${units.map(unit => unit.name).join(', ')}`);

  const runtime = await dependencies.getRuntime();
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
  const synthesis = await synthesizeArchitecture(services, repoStructure, config.model, apiKey);
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
  dependencyHints: string[];
  analysisHints: string[];
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
    options: Partial<Pick<ArchitecturalUnit, 'kindHint' | 'dependencyHints' | 'analysisHints'>> = {},
  ) => {
    const normalizedPath = normalizePath(dirPath);
    const normalizedName = name.trim().toLowerCase();
    if (files.length > 0 && !usedDirPaths.has(normalizedPath) && !usedNames.has(normalizedName)) {
      units.push({
        name,
        dirPath: normalizedPath,
        files,
        kindHint: options.kindHint,
        dependencyHints: [...new Set(options.dependencyHints || [])],
        analysisHints: [...new Set(options.analysisHints || [])],
      });
      usedDirPaths.add(normalizedPath);
      usedNames.add(normalizedName);
    }
  };

  // Phase 0: Infrastructure resources and services declared in compose files.
  for (const composeUnit of detectComposeUnits(repoPath, index)) {
    addUnit(composeUnit.name, composeUnit.dirPath, composeUnit.files, composeUnit);
  }

  // Phase 1: Multi-service container directories.
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

  // Phase 2: Common top-level service/resource directories.
  for (const dirName of TOP_LEVEL_SERVICE_DIRS) {
    const fullPath = path.join(repoPath, dirName);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) continue;
    const files = index.files.filter(f => f.relativePath.startsWith(dirName + '/'));
    addUnit(dirName, dirName, files, {
      kindHint: inferServiceKind(dirName, dirName),
      analysisHints: [`Detected from top-level directory: ${dirName}`],
    });
  }

  // Phase 3: Look under src/ and common containers inside src/.
  for (const parentDir of ['src', 'src/apps', 'src/services', 'src/modules']) {
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
      }
      : {
        name: path.basename(repoPath),
        dirPath: '.',
        files: index.files,
        kindHint: 'app',
        dependencyHints: [],
        analysisHints: ['Fallback to repository root as a single architectural unit'],
      });
  }

  return units;
}

async function analyzeUnit(
  unit: ArchitecturalUnit,
  model: string,
  apiKey: string,
  runtime: IRuntime,
  log: (msg: string) => void,
): Promise<ServiceDesignDoc> {
  const filesContext = formatFilesForContext(unit.files, 30, 5000);
  const systemPrompt = buildServiceAnalysisSystemPrompt();
  const analysisHints = [...unit.analysisHints];
  if (unit.kindHint) analysisHints.push(`Suggested kind: ${unit.kindHint}`);
  if (unit.dependencyHints.length > 0) analysisHints.push(`Known integrations: ${unit.dependencyHints.join(', ')}`);
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
    if (unit.dependencyHints.length > 0) {
      doc.dependencies = [...new Set([...doc.dependencies, ...unit.dependencyHints])];
    }
    return doc;
  } catch (err) {
    log(`  Warning: Analysis failed for ${unit.name}: ${(err as Error).message}`);
    return {
      serviceId: unit.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      name: unit.name,
      kind: unit.kindHint || 'module',
      purpose: buildFallbackPurpose(unit),
      responsibilities: [],
      publicInterfaces: [],
      dependencies: unit.dependencyHints,
      entities: [],
      submodules: [],
      complexityScore: estimateComplexity(unit.files, unit.kindHint),
      risks: [],
    };
  }
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
  if (/(frontend|web|client|ui|mobile|admin|dashboard)/.test(haystack)) return 'app';
  if (/(worker|workers|job|jobs|scheduler|cron|consumer|queue)/.test(haystack)) return 'worker';
  if (/(gateway|proxy|bff|edge)/.test(haystack)) return 'gateway';
  if (/(shared|common|lib|libs|utils?)/.test(haystack)) return 'library';
  if (RESOURCE_NAME_PATTERN.test(haystack)) return 'resource';
  if (/(module|feature|domain)/.test(haystack)) return 'module';
  return 'service';
}

function buildFallbackPurpose(unit: ArchitecturalUnit): string {
  if (unit.kindHint === 'resource') {
    return `${unit.name} infrastructure resource used by the system.`;
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
        dependencyHints: service.dependsOn,
        analysisHints,
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
