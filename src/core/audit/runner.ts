import * as path from 'path';
import * as crypto from 'crypto';
import { Reviewer, AuditResult, ReviewerResult, Finding, Config } from '../../types/index';
import { buildRepoIndex, scopeFilesForReviewer, formatFilesForContext } from '../indexing/index';
import { resolveConfig, getApiKey } from '../config/loader';
import { loadReviewers } from '../reviewers/loader';
import { getRuntime } from '../runtime/factory';
import { reviewerAnalysisSchema, ReviewerAnalysis } from '../validation/schemas';
import { buildAuditSystemPrompt, buildAuditUserMessage } from '../prompts/audit';
import { computeOverallScore } from '../scoring/normalizer';
import { AUDIT_OUTPUT_FILE, OUTPUT_DIR } from '../config/defaults';
import { writeAuditResult, ensureDir } from '../output/writer';

export interface AuditOptions {
  repoPath: string;
  outputPath?: string;
  reviewerIds?: string[];  // filter to specific reviewers
  onProgress?: (msg: string) => void;
}

export async function runAudit(options: AuditOptions): Promise<AuditResult> {
  const { repoPath, onProgress } = options;
  const log = (msg: string) => onProgress?.(msg);

  // Load config
  log('Loading configuration...');
  const config = resolveConfig(repoPath);
  const apiKey = getApiKey(config.apiKeyEnv);

  // Load reviewers
  log('Loading reviewers...');
  const { reviewers, warnings } = loadReviewers(repoPath);
  if (warnings.length) warnings.forEach(w => log(`Warning: ${w}`));

  const activeReviewers = options.reviewerIds
    ? reviewers.filter(r => options.reviewerIds!.includes(r.id))
    : reviewers;

  if (activeReviewers.length === 0) {
    throw new Error('No reviewers found. Run `codeowl init` to set up reviewers.');
  }

  // Build repo index
  log('Indexing repository...');
  const index = await buildRepoIndex(repoPath, config);
  log(`Found ${index.totalFiles} files to analyze.`);

  // Run each reviewer
  const runtime = await getRuntime();
  const reviewerResults: ReviewerResult[] = [];

  for (const reviewer of activeReviewers) {
    log(`Running reviewer: ${reviewer.name}...`);
    const result = await runSingleReviewer(reviewer, index, config, apiKey, runtime);
    reviewerResults.push(result);
    log(`  ✓ ${reviewer.name}: score=${result.score}, findings=${result.findings.length}`);
  }

  // Compute overall score and summary
  const overallScore = computeOverallScore(reviewerResults);
  const totalFindings = reviewerResults.flatMap(r => r.findings).length;
  const criticalCount = reviewerResults.flatMap(r => r.findings).filter(f => f.priority === 'critical').length;

  const summary = buildAuditSummary(overallScore, totalFindings, criticalCount, reviewerResults.length);

  const result: AuditResult = {
    command: 'audit',
    repoPath: path.resolve(repoPath),
    overallScore,
    summary,
    reviewerResults,
    generatedAt: new Date().toISOString(),
  };

  // Write output
  const outputPath = options.outputPath || path.join(repoPath, AUDIT_OUTPUT_FILE);
  ensureDir(path.join(repoPath, OUTPUT_DIR));
  writeAuditResult(outputPath, result);
  log(`Audit report written to: ${outputPath}`);

  return result;
}

async function runSingleReviewer(
  reviewer: Reviewer,
  index: import('../../types/index').RepoIndex,
  config: ReturnType<typeof resolveConfig>,
  apiKey: string,
  runtime: import('../runtime/interface').IRuntime
): Promise<ReviewerResult> {
  const start = Date.now();
  const scopedFiles = scopeFilesForReviewer(index, reviewer.scopeHints, reviewer.recommendedGlobs);
  const filesContext = formatFilesForContext(scopedFiles, 40, 6000);
  const model = reviewer.model || config.model;

  const systemPrompt = buildAuditSystemPrompt(reviewer.instructions, reviewer.id, reviewer.name);
  const userMessage = buildAuditUserMessage(filesContext, index.totalFiles, scopedFiles.length);

  let analysis: ReviewerAnalysis;
  let warnings: string[] = [];

  try {
    const runResult = await runtime.run<ReviewerAnalysis>(
      { systemPrompt, userMessage, model, apiKey, maxTokens: 8096 },
      reviewerAnalysisSchema
    );
    analysis = runResult.data;
  } catch (err) {
    warnings.push(`Reviewer ${reviewer.id} failed: ${(err as Error).message}`);
    analysis = { score: 50, summary: 'Reviewer failed to produce output.', findings: [] };
  }

  // Enrich findings with reviewer metadata
  const enrichedFindings: Finding[] = analysis.findings.map(f => ({
    ...f,
    reviewerId: reviewer.id,
    reviewerName: reviewer.name,
  }));

  return {
    reviewerId: reviewer.id,
    reviewerName: reviewer.name,
    description: reviewer.description,
    score: analysis.score,
    summary: analysis.summary,
    findings: enrichedFindings,
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

function buildAuditSummary(score: number, totalFindings: number, criticalCount: number, reviewerCount: number): string {
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
