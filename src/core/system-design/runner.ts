import * as fs from 'fs';
import * as path from 'path';
import { ServiceDesignDoc, SystemDesignResult } from '../../types/index';
import { resolveConfig, resolveApiKey } from '../config/loader';
import { buildRepoIndex, formatFilesForContext, scopeFilesForReviewer } from '../indexing/index';
import { getRuntime } from '../runtime/factory';
import { serviceDesignDocSchema, ServiceDoc } from '../validation/schemas';
import { buildServiceAnalysisSystemPrompt, buildServiceAnalysisUserMessage } from '../prompts/system-design';
import { synthesizeArchitecture } from './synthesizer';
import { buildGraph } from './graph';
import { writeSystemDesignResult, writeJson, writeText, ensureDir } from '../output/writer';
import { SYSTEM_DESIGN_OUTPUT_DIR } from '../config/defaults';
import { listTopLevelDirs } from '../git/index';

const SYSTEM_DESIGN_TEMPLATE_CANDIDATES = [
  path.resolve(__dirname, '../../templates/system-design-app/index.html'),
  path.resolve(__dirname, '../../../src/templates/system-design-app/index.html'),
];

export interface SystemDesignOptions {
  repoPath: string;
  outputDir?: string;
  onProgress?: (msg: string) => void;
}

export async function runSystemDesign(options: SystemDesignOptions): Promise<SystemDesignResult> {
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
  log(`Detected ${units.length} architectural unit(s): ${units.map(u => u.name).join(', ')}`);

  const runtime = await getRuntime();
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
  files: import('../../types/index').RepoFile[];
}

async function detectArchitecturalUnits(
  repoPath: string,
  index: import('../../types/index').RepoIndex
): Promise<ArchitecturalUnit[]> {
  const units: ArchitecturalUnit[] = [];

  const patterns = ['packages', 'apps', 'services', 'modules'];
  let found = false;

  for (const pattern of patterns) {
    const patternDir = path.join(repoPath, pattern);
    if (fs.existsSync(patternDir)) {
      const subdirs = fs.readdirSync(patternDir).filter(d => {
        const fullPath = path.join(patternDir, d);
        return fs.statSync(fullPath).isDirectory();
      });
      if (subdirs.length > 0) {
        for (const subdir of subdirs) {
          const dirPath = path.join(pattern, subdir);
          const files = index.files.filter(f => f.relativePath.startsWith(dirPath + '/'));
          if (files.length > 0) {
            units.push({ name: subdir, dirPath, files });
          }
        }
        found = true;
        break;
      }
    }
  }

  if (!found) {
    const srcFiles = index.files.filter(f => f.relativePath.startsWith('src/'));
    if (srcFiles.length > 0) {
      units.push({ name: path.basename(repoPath), dirPath: 'src', files: srcFiles });
    } else {
      units.push({ name: path.basename(repoPath), dirPath: '.', files: index.files });
    }
  }

  return units;
}

async function analyzeUnit(
  unit: ArchitecturalUnit,
  model: string,
  apiKey: string,
  runtime: import('../runtime/interface').IRuntime,
  log: (msg: string) => void
): Promise<ServiceDesignDoc> {
  const filesContext = formatFilesForContext(unit.files, 30, 5000);
  const systemPrompt = buildServiceAnalysisSystemPrompt();
  const userMessage = buildServiceAnalysisUserMessage(unit.name, filesContext);

  try {
    const result = await runtime.run<ServiceDoc>(
      { systemPrompt, userMessage, model, apiKey, maxTokens: 4096 },
      serviceDesignDocSchema
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
      risks: ['Analysis failed - manual review required'],
    };
  }
}

function resolveSystemDesignTemplatePath(): string {
  for (const candidate of SYSTEM_DESIGN_TEMPLATE_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `System design template not found. Checked: ${SYSTEM_DESIGN_TEMPLATE_CANDIDATES.join(', ')}`
  );
}

function generateHTMLReport(outputDir: string, graph: import('../../types/index').ArchitectureGraph): void {
  const templatePath = resolveSystemDesignTemplatePath();
  let template = fs.readFileSync(templatePath, 'utf-8');

  const dataJson = JSON.stringify(graph);
  template = template.replace('__CODEOWL_DATA__', dataJson);

  writeText(path.join(outputDir, 'index.html'), template);
}
