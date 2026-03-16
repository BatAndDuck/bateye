import * as fs from 'fs';
import * as path from 'path';
import { PRFinding } from '../../types/index';
import { MAX_PR_FINDING_SUPPORT_FILES } from '../config/defaults';
import { ParsedDiff, isLineNearDiff } from './diff-parser';

export interface RejectedFinding {
  finding: PRFinding;
  reason: string;
}

export interface VerificationResult {
  verified: PRFinding[];
  rejected: RejectedFinding[];
}

const SPECULATIVE_PATTERNS = /\b(may|might|could|likely|possibly|perhaps|appears to|seems to|potentially|probable|presumably)\b/gi;

function normalize(s: string): string {
  return s
    .replace(/^\s*[+-]\s*/, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function codeQuoteExistsInText(codeQuote: string, content: string): boolean {
  const normalizedQuote = normalize(codeQuote);
  if (normalizedQuote.length < 3) return false;
  return normalize(content).includes(normalizedQuote);
}

function codeQuoteExistsInCurrentDiff(codeQuote: string, fileDiff: { hunks: { lines: { content: string; newLineNumber: number | null }[] }[] }): boolean {
  const normalizedQuote = normalize(codeQuote);
  if (normalizedQuote.length < 3) return false;

  for (const hunk of fileDiff.hunks) {
    const currentLines = hunk.lines.filter(line => line.newLineNumber !== null).map(line => normalize(line.content));
    for (const line of currentLines) {
      if (line.includes(normalizedQuote)) {
        return true;
      }
    }
    if (currentLines.join(' ').includes(normalizedQuote)) {
      return true;
    }
  }

  return false;
}

function readCurrentFile(repoPath: string, filePath: string): string | null {
  const absolutePath = path.join(repoPath, filePath);
  if (!fs.existsSync(absolutePath)) {
    return null;
  }

  try {
    return fs.readFileSync(absolutePath, 'utf-8');
  } catch {
    return null;
  }
}

function quoteMatchesAnchoredLines(finding: PRFinding, currentFileContent: string): boolean {
  const lines = currentFileContent.split(/\r?\n/);
  if (finding.startLine < 1 || finding.endLine > lines.length) {
    return false;
  }

  const startIndex = Math.max(0, finding.startLine - 2);
  const endIndex = Math.min(lines.length, finding.endLine + 1);
  const nearbyContent = lines.slice(startIndex, endIndex).join('\n');
  return codeQuoteExistsInText(finding.codeQuote, nearbyContent);
}

export function collectVerificationTrailFiles(finding: Pick<PRFinding, 'verificationTrail'>, repoPath: string): string[] {
  const files = new Set<string>();

  for (const entry of finding.verificationTrail || []) {
    if (!entry.startsWith('file:')) continue;
    const filePath = entry.slice('file:'.length).trim().replace(/\\/g, '/').replace(/^\.\//, '');
    if (!filePath || files.has(filePath)) continue;
    if (fs.existsSync(path.join(repoPath, filePath))) {
      files.add(filePath);
    }
    if (files.size >= MAX_PR_FINDING_SUPPORT_FILES) {
      break;
    }
  }

  return [...files];
}

export function verifyFindings(
  findings: PRFinding[],
  parsedDiff: ParsedDiff,
  repoPath: string,
): VerificationResult {
  const verified: PRFinding[] = [];
  const rejected: RejectedFinding[] = [];

  for (const finding of findings) {
    const fileDiff = parsedDiff.files.get(finding.filePath);
    if (!fileDiff) {
      rejected.push({ finding, reason: `File "${finding.filePath}" not found in diff` });
      continue;
    }

    const currentFileContent = readCurrentFile(repoPath, finding.filePath);
    if (!currentFileContent) {
      rejected.push({ finding, reason: `Current file "${finding.filePath}" could not be read from the repository` });
      continue;
    }

    if (!isLineNearDiff(parsedDiff, finding.filePath, finding.startLine, 3)) {
      rejected.push({
        finding,
        reason: `Line ${finding.startLine} in "${finding.filePath}" is not within or near any changed range in the diff`,
      });
      continue;
    }

    if (!codeQuoteExistsInCurrentDiff(finding.codeQuote, fileDiff)) {
      rejected.push({
        finding,
        reason: `Quoted current code "${finding.codeQuote.slice(0, 60)}..." was not found in added/current diff lines for "${finding.filePath}"`,
      });
      continue;
    }

    if (!codeQuoteExistsInText(finding.codeQuote, currentFileContent)) {
      rejected.push({
        finding,
        reason: `Quoted current code "${finding.codeQuote.slice(0, 60)}..." was not found in the current file content for "${finding.filePath}"`,
      });
      continue;
    }

    if (!quoteMatchesAnchoredLines(finding, currentFileContent)) {
      rejected.push({
        finding,
        reason: `Quoted current code does not match the anchored line range ${finding.startLine}-${finding.endLine} in "${finding.filePath}"`,
      });
      continue;
    }

    const inspectedFiles = collectVerificationTrailFiles(finding, repoPath);
    if (inspectedFiles.length === 0) {
      rejected.push({
        finding,
        reason: 'verificationTrail must include at least one inspected file using the "file:<path>" format',
      });
      continue;
    }

    const speculativeMatches = finding.description.match(SPECULATIVE_PATTERNS) || [];
    if (speculativeMatches.length >= 2 && finding.confidence < 0.8) {
      rejected.push({
        finding,
        reason: `Finding uses speculative language (${speculativeMatches.length} instances: ${speculativeMatches.join(', ')}) with low confidence (${finding.confidence})`,
      });
      continue;
    }

    verified.push(finding);
  }

  return { verified, rejected };
}
