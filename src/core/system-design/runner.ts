import * as fs from 'fs';
import * as path from 'path';
import { ServiceDesignDoc, SystemDesignResult } from '../../types/index';
import { resolveConfig, getApiKey } from '../config/loader';
import { buildRepoIndex, formatFilesForContext, scopeFilesForReviewer } from '../indexing/index';
import { getRuntime } from '../runtime/factory';
import { serviceDesignDocSchema, ServiceDoc } from '../validation/schemas';
import { buildServiceAnalysisSystemPrompt, buildServiceAnalysisUserMessage } from '../prompts/system-design';
import { synthesizeArchitecture } from './synthesizer';
import { buildGraph } from './graph';
import { writeSystemDesignResult, writeJson, writeText, ensureDir } from '../output/writer';
import { SYSTEM_DESIGN_OUTPUT_DIR } from '../config/defaults';
import { listTopLevelDirs } from '../git/index';

export interface SystemDesignOptions {
  repoPath: string;
  outputDir?: string;
  onProgress?: (msg: string) => void;
}

export async function runSystemDesign(options: SystemDesignOptions): Promise<SystemDesignResult> {
  const { repoPath, onProgress } = options;
  const log = (msg: string) => onProgress?.(msg);
  const outputDir = options.outputDir || path.join(repoPath, SYSTEM_DESIGN_OUTPUT_DIR);

  // Load config
  log('Loading configuration...');
  const config = resolveConfig(repoPath);
  const apiKey = getApiKey(config.apiKeyEnv);

  // Build repo index
  log('Indexing repository...');
  const index = await buildRepoIndex(repoPath, config);
  log(`Found ${index.totalFiles} files.`);

  // Detect services/modules
  log('Detecting services and modules...');
  const units = await detectArchitecturalUnits(repoPath, index);
  log(`Detected ${units.length} architectural unit(s): ${units.map(u => u.name).join(', ')}`);

  // Analyze each unit
  const runtime = await getRuntime();
  const services: ServiceDesignDoc[] = [];

  for (const unit of units) {
    log(`Analyzing: ${unit.name}...`);
    const serviceDoc = await analyzeUnit(unit, config.model, apiKey, runtime, log);
    services.push(serviceDoc);
    log(`  ✓ ${unit.name}: ${serviceDoc.kind}`);
  }

  // Get repo structure for synthesis
  const topLevelDirs = await listTopLevelDirs(repoPath);
  const repoStructure = `Top-level directories: ${topLevelDirs.join(', ')}\nTotal files: ${index.totalFiles}`;

  // Synthesize overall architecture
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

  // Write output files
  log('Writing output files...');
  ensureDir(outputDir);
  writeSystemDesignResult(outputDir, result);

  // Write graph.json
  const graph = buildGraph(result);
  writeJson(path.join(outputDir, 'graph.json'), graph);

  // Write summary.json
  writeJson(path.join(outputDir, 'summary.json'), {
    architectureType: result.architectureType,
    score: result.score,
    strengths: result.strengths,
    weaknesses: result.weaknesses,
    globalSummary: result.globalSummary,
    serviceCount: services.length,
    generatedAt,
  });

  // Generate interactive HTML report
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

  // Strategy: look for common patterns indicating distinct services/modules
  // 1. packages/* (monorepo)
  // 2. apps/*
  // 3. services/*
  // 4. src/* (single service)

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
    // Single service: use top-level src or the whole repo
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
      risks: ['Analysis failed — manual review required'],
    };
  }
}

function generateHTMLReport(outputDir: string, graph: import('../../types/index').ArchitectureGraph): void {
  const templatePath = path.join(__dirname, '../../templates/system-design-app/index.html');
  let template = fs.readFileSync(templatePath, 'utf-8');

  // Replace data placeholder with actual data
  const dataJson = JSON.stringify(graph);
  template = template.replace('__CODEOWL_DATA__', dataJson);

  writeText(path.join(outputDir, 'index.html'), template);
}
