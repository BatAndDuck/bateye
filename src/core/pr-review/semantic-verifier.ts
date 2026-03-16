import * as fs from 'fs';
import * as path from 'path';
import { PRFinding, ReviewIssue } from '../../types/index';
import { IRuntime, TokenUsage } from '../runtime/interface';
import { prFindingBatchVerificationSchema } from '../validation/schemas';
import {
  buildPRFindingBatchVerificationSystemPrompt,
  buildPRFindingBatchVerificationUserMessage,
} from '../prompts/pr-review';
import { collectVerificationTrailFiles, RejectedFinding } from './verifier';

export interface SemanticVerificationResult {
  verified: PRFinding[];
  rejected: RejectedFinding[];
  issues: ReviewIssue[];
  tokensUsed?: TokenUsage;
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

/** Number of findings to verify per AI call. Batching reduces total call count substantially. */
const VERIFICATION_BATCH_SIZE = 5;

function readFileContent(repoPath: string, filePath: string): string | null {
  try {
    return fs.readFileSync(path.join(repoPath, filePath), 'utf-8');
  } catch {
    return null;
  }
}

function addTokens(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    estimated: a.estimated || b.estimated,
  };
}

type FindingWithContext = {
  finding: PRFinding;
  currentFileContent: string;
  supportingFiles: Array<{ filePath: string; content: string }>;
};

async function verifyBatch(
  batch: FindingWithContext[],
  options: SemanticVerifierOptions,
): Promise<{
  results: Map<string, { supported: boolean; reason: string }>;
  tokensUsed?: TokenUsage;
  error?: string;
}> {
  const model = options.model;
  // maxTokens scales with batch size: ~400 tokens per finding verdict
  const maxTokens = Math.max(1024, VERIFICATION_BATCH_SIZE * 512);

  try {
    const result = await options.runtime.run(
      {
        systemPrompt: buildPRFindingBatchVerificationSystemPrompt(),
        userMessage: buildPRFindingBatchVerificationUserMessage(batch),
        model,
        apiKey: options.apiKey,
        transport: options.transport,
        apiBaseUrl: options.apiBaseUrl,
        maxTokens,
        temperature: 0,
        cwd: options.repoPath,
        callLabel: 'semantic-verifier',
      },
      prFindingBatchVerificationSchema,
    );

    const resultMap = new Map<string, { supported: boolean; reason: string }>();
    for (const v of result.data.verifications) {
      resultMap.set(v.findingId, { supported: v.supported, reason: v.reason });
    }
    return { results: resultMap, tokensUsed: result.tokensUsed };
  } catch (err) {
    return { results: new Map(), error: (err as Error).message };
  }
}

export async function verifyFindingsSemantically(
  findings: PRFinding[],
  options: SemanticVerifierOptions,
): Promise<SemanticVerificationResult> {
  const verified: PRFinding[] = [];
  const rejected: RejectedFinding[] = [];
  const issues: ReviewIssue[] = [];
  let totalTokens: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  let hasTokenData = false;

  // Build context for each finding, reject immediately if primary file unreadable
  const findingsWithContext: FindingWithContext[] = [];
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

    findingsWithContext.push({ finding, currentFileContent, supportingFiles });
  }

  if (findingsWithContext.length === 0) {
    return { verified, rejected, issues };
  }

  // Chunk into batches
  const batches: FindingWithContext[][] = [];
  for (let i = 0; i < findingsWithContext.length; i += VERIFICATION_BATCH_SIZE) {
    batches.push(findingsWithContext.slice(i, i + VERIFICATION_BATCH_SIZE));
  }

  options.log?.(`  Semantic verification: ${findingsWithContext.length} finding(s) in ${batches.length} batch(es) using ${options.model}`);

  // Run all batches in parallel
  const batchResults = await Promise.all(batches.map(batch => verifyBatch(batch, options)));

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];
    const { results, tokensUsed, error } = batchResults[batchIdx];

    if (tokensUsed) {
      totalTokens = addTokens(totalTokens, tokensUsed);
      hasTokenData = true;
    }

    if (error) {
      options.log?.(`  ✗ Semantic verifier batch ${batchIdx + 1}/${batches.length} failed: ${error}`);
      // Fall back: accept all findings in this batch (don't penalise for infra errors)
      for (const { finding } of batch) {
        issues.push({
          severity: 'warning',
          code: 'pr-semantic-verifier-failed',
          message: `Semantic verifier batch failed for "${finding.title}": ${error}`,
          stage: 'semantic-verification',
          reviewerId: finding.reviewerId,
          reviewerName: finding.reviewerName,
        });
        rejected.push({ finding, reason: `Semantic verification batch failed: ${error}` });
      }
      continue;
    }

    for (const { finding } of batch) {
      const verdict = results.get(finding.id);
      if (!verdict) {
        // Finding ID wasn't in the response — accept it (don't discard valid findings due to model slip)
        verified.push(finding);
        continue;
      }
      if (verdict.supported) {
        verified.push(finding);
      } else {
        rejected.push({ finding, reason: verdict.reason });
      }
    }
  }

  return {
    verified,
    rejected,
    issues,
    tokensUsed: hasTokenData ? totalTokens : undefined,
  };
}
