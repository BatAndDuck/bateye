import * as fs from 'fs';
import * as path from 'path';
import { PRFinding, ReviewIssue } from '../../types/index';
import { MAX_PR_CURRENT_FILE_CHARS } from '../config/defaults';
import { IRuntime, TokenUsage } from '../runtime/interface';
import { addTokens } from '../runtime/token-utils';
import { prFindingBatchVerificationSchema } from '../validation/schemas';
import {
  buildPRFindingBatchVerificationSystemPrompt,
  buildPRFindingBatchVerificationUserMessage,
} from '../prompts/pr-review';
import { collectVerificationTrailFiles, RejectedFinding } from './verifier';
import { DiffHunk, ParsedDiff } from './diff-parser';
import { logPrompt } from '../output/prompt-logger';

export interface SemanticVerificationResult {
  verified: PRFinding[];
  rejected: RejectedFinding[];
  issues: ReviewIssue[];
  tokensUsed?: TokenUsage;
}

export interface SemanticVerifierOptions {
  repoPath: string;
  parsedDiff: ParsedDiff;
  runtime: IRuntime;
  model: string;
  apiKey: string;
  transport: string;
  apiBaseUrl?: string;
  log?: (message: string) => void;
  promptLogDir?: string;
}

/** Number of findings to verify per AI call. Batching reduces total call count substantially. */
const VERIFICATION_BATCH_SIZE = 5;
const DIFF_TOLERANCE_LINES = 3;
/** Per-batch LLM call timeout - longer than the default 120s to survive cold-start DB migrations. */
const SEMANTIC_VERIFIER_TIMEOUT_MS = 480_000;
/** Maximum retry attempts per batch when a transient error (timeout, connection reset) occurs. */
const BATCH_MAX_ATTEMPTS = 3;

function isTransientError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    msg.includes('econnreset') ||
    msg.includes('socket hang up') ||
    msg.includes('aborted') ||
    msg.includes('network')
  );
}

function readFileContent(repoPath: string, filePath: string): string | null {
  try {
    const content = fs.readFileSync(path.join(repoPath, filePath), 'utf-8');
    if (content.length > MAX_PR_CURRENT_FILE_CHARS) {
      return content.slice(0, MAX_PR_CURRENT_FILE_CHARS) + `\n... [truncated at ${MAX_PR_CURRENT_FILE_CHARS} chars]`;
    }
    return content;
  } catch {
    return null;
  }
}

function formatDiffHunk(hunk: DiffHunk): string {
  return hunk.lines.map(line => {
    if (line.type === 'add') {
      return `[Line ${line.newLineNumber}] + ${line.content}`;
    }
    if (line.type === 'remove') {
      return `[Removed ${line.oldLineNumber}] - ${line.content}`;
    }
    return `[Line ${line.newLineNumber}]   ${line.content}`;
  }).join('\n');
}

function buildDiffContext(parsedDiff: ParsedDiff, finding: PRFinding): string {
  const fileDiff = parsedDiff.files.get(finding.filePath);
  if (!fileDiff) {
    return `Anchor file "${finding.filePath}" is not present in the PR diff.`;
  }

  const relevantHunk = fileDiff.hunks.find(hunk =>
    hunk.lines.some(line =>
      line.newLineNumber !== null
      && line.newLineNumber >= finding.startLine - DIFF_TOLERANCE_LINES
      && line.newLineNumber <= finding.endLine + DIFF_TOLERANCE_LINES,
    ),
  );

  if (!relevantHunk) {
    return `Anchor line range ${finding.startLine}-${finding.endLine} in "${finding.filePath}" is not within or near any changed hunk in the PR diff.`;
  }

  return `Anchor file: ${finding.filePath}
Anchor line range: ${finding.startLine}-${finding.endLine}

Relevant PR hunk:
\`\`\`diff
${formatDiffHunk(relevantHunk)}
\`\`\``;
}

type FindingWithContext = {
  finding: PRFinding;
  currentFileContent: string;
  diffContext: string;
  supportingFiles: Array<{ filePath: string; content: string }>;
};

type SemanticVerdict = {
  supported: boolean;
  classification: 'direct' | 'companion' | 'unrelated' | 'unclear';
  reason: string;
};

async function verifyBatch(
  batch: FindingWithContext[],
  options: SemanticVerifierOptions,
  batchIndex: number,
): Promise<{
  results: Map<string, SemanticVerdict>;
  tokensUsed?: TokenUsage;
  error?: string;
}> {
  const maxTokens = Math.max(1024, VERIFICATION_BATCH_SIZE * 512);
  const systemPrompt = buildPRFindingBatchVerificationSystemPrompt();
  const userMessage = buildPRFindingBatchVerificationUserMessage(batch);

  if (options.promptLogDir) {
    logPrompt(options.promptLogDir, `semantic-verifier-batch${batchIndex}`, systemPrompt, userMessage);
  }

  let lastError: unknown;

  for (let attempt = 1; attempt <= BATCH_MAX_ATTEMPTS; attempt++) {
    try {
      const result = await options.runtime.run(
        {
          systemPrompt,
          userMessage,
          model: options.model,
          apiKey: options.apiKey,
          transport: options.transport,
          apiBaseUrl: options.apiBaseUrl,
          maxTokens,
          temperature: 0,
          cwd: options.repoPath,
          callLabel: `semantic-verifier-b${batchIndex}`,
          timeoutMs: SEMANTIC_VERIFIER_TIMEOUT_MS,
        },
        prFindingBatchVerificationSchema,
      );

      const resultMap = new Map<string, SemanticVerdict>();
      for (const v of result.data.verifications) {
        resultMap.set(v.findingId, {
          supported: v.supported,
          classification: v.classification,
          reason: v.reason,
        });
      }
      return { results: resultMap, tokensUsed: result.tokensUsed };
    } catch (err) {
      lastError = err;
      const transient = isTransientError(err);
      if (transient && attempt < BATCH_MAX_ATTEMPTS) {
        const delayMs = 5_000 * attempt; // 5s, 10s
        options.log?.(`  ⚠ Semantic verifier batch ${batchIndex + 1} attempt ${attempt}/${BATCH_MAX_ATTEMPTS} failed (transient), retrying in ${delayMs / 1000}s: ${(err as Error).message.slice(0, 120)}`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }
      break;
    }
  }

  return { results: new Map(), error: (lastError as Error).message };
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

    findingsWithContext.push({
      finding,
      currentFileContent,
      diffContext: buildDiffContext(options.parsedDiff, finding),
      supportingFiles,
    });
  }

  if (findingsWithContext.length === 0) {
    return { verified, rejected, issues };
  }

  const batches: FindingWithContext[][] = [];
  for (let i = 0; i < findingsWithContext.length; i += VERIFICATION_BATCH_SIZE) {
    batches.push(findingsWithContext.slice(i, i + VERIFICATION_BATCH_SIZE));
  }

  options.log?.(`  Semantic verification: ${findingsWithContext.length} finding(s) in ${batches.length} batch(es) using ${options.model}`);

  // Run batches sequentially so the OpenCode server processes one at a time.
  // Parallel batches compete for the single-threaded server and risk hitting the
  // per-request timeout when a cold-start DB migration is still in progress.
  const batchResults: Awaited<ReturnType<typeof verifyBatch>>[] = [];
  for (let i = 0; i < batches.length; i++) {
    batchResults.push(await verifyBatch(batches[i], options, i));
  }

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];
    const { results, tokensUsed, error } = batchResults[batchIdx];

    if (tokensUsed) {
      totalTokens = addTokens(totalTokens, tokensUsed);
      hasTokenData = true;
    }

    if (error) {
      options.log?.(`  ✗ Semantic verifier batch ${batchIdx + 1}/${batches.length} failed: ${error}`);
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
        const message = `Semantic verifier returned no verdict for "${finding.title}"`;
        issues.push({
          severity: 'warning',
          code: 'pr-semantic-verifier-missing-verdict',
          message,
          stage: 'semantic-verification',
          reviewerId: finding.reviewerId,
          reviewerName: finding.reviewerName,
        });
        rejected.push({
          finding,
          reason: 'Semantic verifier returned no verdict for this finding',
        });
        continue;
      }

      if (verdict.supported) {
        verified.push(finding);
      } else {
        rejected.push({
          finding,
          reason: `[${verdict.classification}] ${verdict.reason}`,
        });
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
