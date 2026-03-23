import * as fs from 'fs';
import * as path from 'path';
import { AuditResult, PRReviewResult } from '../../types/index';

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
