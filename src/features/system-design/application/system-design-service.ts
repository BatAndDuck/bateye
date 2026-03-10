import * as fs from 'fs';
import * as path from 'path';
import { ServiceDesignDoc, SystemDesignResult } from '../../../types/index';
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
  files: import('../../../types/index').RepoFile[];
}

async function detectArchitecturalUnits(
  repoPath: string,
  index: import('../../../types/index').RepoIndex,
): Promise<ArchitecturalUnit[]> {
  const units: ArchitecturalUnit[] = [];
  const usedDirPaths = new Set<string>();

  const addUnit = (name: string, dirPath: string, files: import('../../../types/index').RepoFile[]) => {
    const normalized = dirPath.replace(/\\/g, '/');
    if (files.length > 0 && !usedDirPaths.has(normalized)) {
      units.push({ name, dirPath: normalized, files });
      usedDirPaths.add(normalized);
    }
  };

  // Phase 1: Multi-service container directories (packages/, apps/, services/, modules/)
  const multiServicePatterns = ['packages', 'apps', 'services', 'modules'];
  for (const pattern of multiServicePatterns) {
    const patternDir = path.join(repoPath, pattern);
    if (!fs.existsSync(patternDir)) continue;
    const subdirs = fs.readdirSync(patternDir)
      .filter(e => fs.statSync(path.join(patternDir, e)).isDirectory());
    for (const subdir of subdirs) {
      const dirPath = `${pattern}/${subdir}`;
      const files = index.files.filter(f => f.relativePath.startsWith(dirPath + '/'));
      addUnit(subdir, dirPath, files);
    }
  }

  // Phase 2: Common top-level service/component directories
  const topLevelCandidates = [
    'frontend', 'web', 'client', 'ui',
    'backend', 'api', 'server',
    'worker', 'workers', 'jobs', 'queue',
    'admin', 'dashboard', 'mobile',
    'shared', 'common', 'lib', 'libs',
    'gateway', 'proxy',
  ];
  for (const dirName of topLevelCandidates) {
    const fullPath = path.join(repoPath, dirName);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) continue;
    const files = index.files.filter(f => f.relativePath.startsWith(dirName + '/'));
    addUnit(dirName, dirName, files);
  }

  // Phase 3: If nothing found yet, try src/ subdirectories
  if (units.length === 0) {
    const srcPath = path.join(repoPath, 'src');
    if (fs.existsSync(srcPath)) {
      const srcSubdirs = fs.readdirSync(srcPath)
        .filter(e => fs.statSync(path.join(srcPath, e)).isDirectory());
      if (srcSubdirs.length > 1) {
        for (const subdir of srcSubdirs) {
          const dirPath = `src/${subdir}`;
          const files = index.files.filter(f => f.relativePath.startsWith(dirPath + '/'));
          if (files.length >= 2) addUnit(subdir, dirPath, files);
        }
      }
    }
  }

  // Fallback: entire src/ or root as a single unit
  if (units.length === 0) {
    const srcFiles = index.files.filter(f => f.relativePath.startsWith('src/'));
    units.push(srcFiles.length > 0
      ? { name: path.basename(repoPath), dirPath: 'src', files: srcFiles }
      : { name: path.basename(repoPath), dirPath: '.', files: index.files });
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
  const userMessage = buildServiceAnalysisUserMessage(unit.name, filesContext);

  try {
    const result = await runtime.run<ServiceDoc>(
      { systemPrompt, userMessage, model, apiKey, maxTokens: 4096 },
      serviceDesignDocSchema,
    );
    return result.data as ServiceDesignDoc;
  } catch (err) {
    log(`  Warning: Analysis failed for ${unit.name}: ${(err as Error).message}`);
    return {
      serviceId: unit.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      name: unit.name,
      kind: 'module',
      purpose: `Module at ${unit.dirPath}`,
      responsibilities: [],
      publicInterfaces: [],
      dependencies: [],
      entities: [],
      submodules: [],
      complexityScore: 3,
      risks: ['Analysis failed - manual review required'],
    };
  }
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
