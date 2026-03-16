import * as fs from 'fs';
import * as path from 'path';
import { PRFinding } from '../../types/index';
import { IRuntime } from '../runtime/interface';
import { PRFindingVerification, prFindingVerificationSchema } from '../validation/schemas';
import { buildPRFindingVerificationSystemPrompt, buildPRFindingVerificationUserMessage } from '../prompts/pr-review';
import { collectVerificationTrailFiles, RejectedFinding } from './verifier';

export interface SemanticVerificationResult {
  verified: PRFinding[];
  rejected: RejectedFinding[];
}

export interface SemanticVerifierOptions {
  repoPath: string;
  runtime: IRuntime;
  model: string;
  apiKey: string;
  transport: string;
  apiBaseUrl?: string;
  log?: (message: string) => void;
}

function readFileContent(repoPath: string, filePath: string): string | null {
  try {
    return fs.readFileSync(path.join(repoPath, filePath), 'utf-8');
  } catch {
    return null;
  }
}

export async function verifyFindingsSemantically(
  findings: PRFinding[],
  options: SemanticVerifierOptions,
): Promise<SemanticVerificationResult> {
  const verified: PRFinding[] = [];
  const rejected: RejectedFinding[] = [];

  for (const finding of findings) {
    const currentFileContent = readFileContent(options.repoPath, finding.filePath);
    if (!currentFileContent) {
      rejected.push({
        finding,
        reason: `Current file "${finding.filePath}" could not be loaded for semantic verification`,
      });
      continue;
    }

    const supportingFiles = collectVerificationTrailFiles(finding, options.repoPath)
      .filter(filePath => filePath !== finding.filePath)
      .map(filePath => ({ filePath, content: readFileContent(options.repoPath, filePath) }))
      .filter((entry): entry is { filePath: string; content: string } => typeof entry.content === 'string');

    try {
      const verification = await options.runtime.run<PRFindingVerification>(
        {
          systemPrompt: buildPRFindingVerificationSystemPrompt(),
          userMessage: buildPRFindingVerificationUserMessage(finding, currentFileContent, supportingFiles),
          model: options.model,
          apiKey: options.apiKey,
          transport: options.transport,
          apiBaseUrl: options.apiBaseUrl,
          maxTokens: 2048,
          temperature: 0,
          cwd: options.repoPath,
        },
        prFindingVerificationSchema,
      );

      if (verification.data.supported) {
        verified.push(finding);
      } else {
        rejected.push({
          finding,
          reason: verification.data.reason,
        });
      }
    } catch (err) {
      options.log?.(`  ✗ Semantic verifier failed for "${finding.title}": ${(err as Error).message}`);
      rejected.push({
        finding,
        reason: `Semantic verification failed: ${(err as Error).message}`,
      });
    }
  }

  return { verified, rejected };
}
