import * as fs from 'fs';
import * as path from 'path';
import { ZodError } from 'zod';
import { PRFinding } from '../../types/index';
import { MAX_PR_FINDING_SUPPORT_FILES } from '../config/defaults';
import { prFindingSchema } from '../validation/schemas';
import { ParsedDiff } from './diff-parser';

export interface RejectedFinding {
  finding: PRFinding;
  reason: string;
}

export interface VerificationResult {
  verified: PRFinding[];
  rejected: RejectedFinding[];
}

function formatSchemaError(error: ZodError): string {
  return error.issues
    .map(issue => {
      const pathLabel = issue.path.length > 0 ? issue.path.join('.') : 'root';
      return `${pathLabel}: ${issue.message}`;
    })
    .join('; ');
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

/**
 * Lines within this many positions of a diff hunk boundary are considered
 * "near" the diff for the purpose of the diff-gate check.
 */
const DIFF_GATE_TOLERANCE_LINES = 3;

/**
 * Hard deterministic gate: rejects findings whose anchor file or lines are
 * not present in (or within DIFF_GATE_TOLERANCE_LINES of) the PR diff.
 *
 * This runs before findings are reported so non-diff findings are rejected
 * deterministically without any extra LLM filtering.
 */
export function verifyFindingsAgainstDiff(
  findings: PRFinding[],
  parsedDiff: ParsedDiff,
): VerificationResult {
  const verified: PRFinding[] = [];
  const rejected: RejectedFinding[] = [];

  for (const finding of findings) {
    const fileDiff = parsedDiff.files.get(finding.filePath);
    if (!fileDiff) {
      rejected.push({
        finding,
        reason: `[diff-gate] File "${finding.filePath}" is not in the PR diff`,
      });
      continue;
    }

    const nearHunk = fileDiff.hunks.some(hunk =>
      hunk.lines.some(line =>
        line.newLineNumber !== null
        && line.newLineNumber >= finding.startLine - DIFF_GATE_TOLERANCE_LINES
        && line.newLineNumber <= finding.endLine + DIFF_GATE_TOLERANCE_LINES,
      ),
    );

    if (!nearHunk) {
      rejected.push({
        finding,
        reason: `[diff-gate] Lines ${finding.startLine}-${finding.endLine} in "${finding.filePath}" are not within or near any changed hunk in the PR diff`,
      });
      continue;
    }

    verified.push(finding);
  }

  return { verified, rejected };
}

export function verifyFindings(findings: PRFinding[]): VerificationResult {
  const verified: PRFinding[] = [];
  const rejected: RejectedFinding[] = [];

  for (const finding of findings) {
    const parsed = prFindingSchema.safeParse(finding);
    if (!parsed.success) {
      rejected.push({
        finding,
        reason: `Finding did not match PR finding schema: ${formatSchemaError(parsed.error)}`,
      });
      continue;
    }

    verified.push(parsed.data);
  }

  return { verified, rejected };
}
