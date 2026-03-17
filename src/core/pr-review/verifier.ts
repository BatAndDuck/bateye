import * as fs from 'fs';
import * as path from 'path';
import { ZodError } from 'zod';
import { PRFinding } from '../../types/index';
import { MAX_PR_FINDING_SUPPORT_FILES } from '../config/defaults';
import { prFindingSchema } from '../validation/schemas';

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
