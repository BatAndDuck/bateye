import { PRFinding } from '../../types/index';
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

function codeQuoteExistsInDiff(codeQuote: string, fileDiff: { hunks: { lines: { content: string }[] }[] }): boolean {
  const normalizedQuote = normalize(codeQuote);
  if (normalizedQuote.length < 3) return false;

  for (const hunk of fileDiff.hunks) {
    for (const line of hunk.lines) {
      const normalizedLine = normalize(line.content);
      if (normalizedLine.includes(normalizedQuote)) {
        return true;
      }
    }

    // Also check multi-line: concatenate consecutive lines and search
    const allContent = hunk.lines.map(l => normalize(l.content)).join(' ');
    if (allContent.includes(normalizedQuote)) {
      return true;
    }
  }

  return false;
}

export function verifyFindings(
  findings: PRFinding[],
  parsedDiff: ParsedDiff
): VerificationResult {
  const verified: PRFinding[] = [];
  const rejected: RejectedFinding[] = [];

  for (const finding of findings) {
    // Gate 1: File must exist in diff
    const fileDiff = parsedDiff.files.get(finding.filePath);
    if (!fileDiff) {
      rejected.push({ finding, reason: `File "${finding.filePath}" not found in diff` });
      continue;
    }

    // Gate 2: Line must be within or near changed range
    if (!isLineNearDiff(parsedDiff, finding.filePath, finding.startLine, 3)) {
      rejected.push({
        finding,
        reason: `Line ${finding.startLine} in "${finding.filePath}" is not within or near any changed range in the diff`,
      });
      continue;
    }

    // Gate 3: Code quote must appear in diff content
    if (!codeQuoteExistsInDiff(finding.codeQuote, fileDiff)) {
      rejected.push({
        finding,
        reason: `Quoted code "${finding.codeQuote.slice(0, 60)}..." not found in diff content for "${finding.filePath}"`,
      });
      continue;
    }

    // Gate 4: Filter speculative language
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
