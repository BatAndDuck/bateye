import * as path from 'path';
import { AuditResult, Finding, Reviewer, ReviewerResult } from '../../../types/index';
import { buildRepoIndex, formatFilesForContext, scopeFilesForReviewer } from '../../../core/indexing/index';
import { reviewerAnalysisSchema, ReviewerAnalysis } from '../../../core/validation/schemas';
import { buildAuditSystemPrompt, buildAuditUserMessage } from '../../../core/prompts/audit';
import { computeOverallScore } from '../../../core/scoring/normalizer';
import { AUDIT_OUTPUT_FILE, OUTPUT_DIR, MAX_FILES_FOR_REVIEWER_CONTEXT, MAX_CHARS_PER_REVIEWER_FILE } from '../../../core/config/defaults';
import { ensureDir, writeAuditResult } from '../../../core/output/writer';
import { IRuntime } from '../../../core/runtime/interface';
import { getRuntime } from '../../../core/runtime/factory';
import { resolveApiKey, resolveConfig } from '../../config/application/config-service';
import { loadReviewers } from '../../reviewers/application/reviewer-registry';

export interface AuditOptions {
  repoPath: string;
  outputPath?: string;
  reviewerIds?: string[];
  onProgress?: (msg: string) => void;
}

export interface AuditDependencies {
  getRuntime: () => Promise<IRuntime>;
}

const defaultDependencies: AuditDependencies = {
  getRuntime,
};

export async function runAudit(options: AuditOptions, dependencies: AuditDependencies = defaultDependencies): Promise<AuditResult> {
  const { repoPath, onProgress } = options;
  const log = (msg: string) => onProgress?.(msg);

  log('Loading configuration...');
  const config = resolveConfig(repoPath);
  const apiKey = resolveApiKey();

  log('Loading reviewers...');
  const { reviewers, warnings } = loadReviewers(repoPath);
  warnings.forEach(warning => log(`Warning: ${warning}`));

  const activeReviewers = options.reviewerIds
    ? reviewers.filter(reviewer => options.reviewerIds!.includes(reviewer.id))
    : reviewers;

  if (activeReviewers.length === 0) {
    throw new Error('No reviewers found. Built-in reviewers should load automatically; add custom reviewers to .codeowl/reviewers if needed.');
  }

  log('Indexing repository...');
  const index = await buildRepoIndex(repoPath, config);
  log(`Found ${index.totalFiles} files to analyze.`);

  const runtime = await dependencies.getRuntime();
  const reviewerResults: ReviewerResult[] = [];

  for (const reviewer of activeReviewers) {
    log(`Running reviewer: ${reviewer.name}...`);
    const result = await runSingleReviewer(reviewer, index, config, apiKey, runtime);
    reviewerResults.push(result);
    log(`  ✓ ${reviewer.name}: score=${result.score}, findings=${result.findings.length}`);
  }

  const overallScore = computeOverallScore(reviewerResults);
  const totalFindings = reviewerResults.flatMap(result => result.findings).length;
  const criticalCount = reviewerResults.flatMap(result => result.findings).filter(finding => finding.priority === 'critical').length;

  const result: AuditResult = {
    command: 'audit',
    repoPath: path.resolve(repoPath),
    overallScore,
    summary: buildAuditSummary(overallScore, totalFindings, criticalCount, reviewerResults.length),
    reviewerResults,
    generatedAt: new Date().toISOString(),
  };

  const outputPath = options.outputPath || path.join(repoPath, AUDIT_OUTPUT_FILE);
  ensureDir(path.join(repoPath, OUTPUT_DIR));
  writeAuditResult(outputPath, result);
  log(`Audit report written to: ${outputPath}`);

  return result;
}

async function runSingleReviewer(
  reviewer: Reviewer,
  index: import('../../../types/index').RepoIndex,
  config: ReturnType<typeof resolveConfig>,
  apiKey: string,
  runtime: IRuntime,
): Promise<ReviewerResult> {
  const start = Date.now();
  const scopedFiles = scopeFilesForReviewer(index, reviewer.scopeHints, reviewer.recommendedGlobs);
  const filesContext = formatFilesForContext(scopedFiles, MAX_FILES_FOR_REVIEWER_CONTEXT, MAX_CHARS_PER_REVIEWER_FILE);
  const model = reviewer.model || config.model;

  const systemPrompt = buildAuditSystemPrompt(reviewer.instructions, reviewer.id, reviewer.name);
  const userMessage = buildAuditUserMessage(filesContext, index.totalFiles, scopedFiles.length);

  let analysis: ReviewerAnalysis;
  let warnings: string[] = [];

  try {
    const result = await runtime.run<ReviewerAnalysis>(
      {
        systemPrompt,
        userMessage,
        model,
        apiKey,
        transport: config.transport,
        apiBaseUrl: config.apiBaseUrl,
        maxTokens: 8096,
      },
      reviewerAnalysisSchema,
    );
    analysis = result.data;
  } catch (err) {
    warnings.push(`Reviewer ${reviewer.id} failed: ${(err as Error).message}`);
    analysis = { score: 50, summary: 'Reviewer failed to produce output.', findings: [] };
  }

  const findings: Finding[] = analysis.findings.map(finding => ({
    ...finding,
    reviewerId: reviewer.id,
    reviewerName: reviewer.name,
  }));

  return {
    reviewerId: reviewer.id,
    reviewerName: reviewer.name,
    description: reviewer.description,
    score: analysis.score,
    summary: analysis.summary,
    findings,
    execution: {
      model,
      runtime: 'sdk',
      durationMs: Date.now() - start,
      scopedFiles: scopedFiles.length,
      totalRepoFilesSeen: index.totalFiles,
      warnings,
    },
  };
}

export function buildAuditSummary(score: number, totalFindings: number, criticalCount: number, reviewerCount: number): string {
  if (score >= 90) {
    return `Excellent code health. ${totalFindings} minor findings across ${reviewerCount} reviewers.`;
  }
  if (score >= 75) {
    return `Good code health with ${totalFindings} findings across ${reviewerCount} reviewers. ${criticalCount > 0 ? `${criticalCount} critical issues require attention.` : 'No critical issues.'}`;
  }
  if (score >= 50) {
    return `Code quality needs improvement. ${totalFindings} findings across ${reviewerCount} reviewers, including ${criticalCount} critical issues.`;
  }
  return `Significant issues detected. ${totalFindings} findings across ${reviewerCount} reviewers, with ${criticalCount} critical issues that should be addressed immediately.`;
}
