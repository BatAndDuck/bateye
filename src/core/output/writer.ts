import * as fs from 'fs';
import * as path from 'path';
import { AuditResult, PRReviewResult, SystemDesignResult } from '../../types/index';

export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function writeJson(filePath: string, data: unknown): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

export function writeText(filePath: string, content: string): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf-8');
}

export function writeAuditResult(outputPath: string, result: AuditResult): void {
  writeJson(outputPath, result);
}

export function writePRReviewResult(outputPath: string, result: PRReviewResult): void {
  writeJson(outputPath, result);
}

export function writeSystemDesignResult(outputDir: string, result: SystemDesignResult): void {
  ensureDir(outputDir);
  ensureDir(path.join(outputDir, 'services'));
  // Write each service
  for (const service of result.services) {
    writeJson(path.join(outputDir, 'services', `${service.serviceId}.json`), service);
    writeText(
      path.join(outputDir, 'services', `${service.serviceId}.md`),
      generateServiceMarkdown(service)
    );
  }
}

function generateServiceMarkdown(service: import('../../types/index').ServiceDesignDoc): string {
  return `# ${service.name}

**Kind:** ${service.kind}
**ID:** ${service.serviceId}
**Complexity:** ${service.complexityScore}/10

## Purpose
${service.purpose}

## Responsibilities
${service.responsibilities.map(r => `- ${r}`).join('\n')}

## Submodules
${service.submodules.length === 0 ? '_None detected_' : service.submodules.map(module => `- ${module}`).join('\n')}

## Public Interfaces
${service.publicInterfaces.length === 0 ? '_None_' : service.publicInterfaces.map(i => `- **${i.type}** \`${i.name}\`${i.description ? ': ' + i.description : ''}`).join('\n')}

## Dependencies
${service.dependencies.length === 0 ? '_None_' : service.dependencies.map(d => `- ${d}`).join('\n')}

## Entities / Data
${service.entities.length === 0 ? '_None_' : service.entities.map(e => `### ${e.name}${e.description ? '\n' + e.description : ''}${e.fields ? '\n\nFields: ' + e.fields.join(', ') : ''}`).join('\n\n')}
`;
}
