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
import { loadReviewersForMode } from '../../reviewers/application/reviewer-registry';
import { selectAuditReviewers } from './audit-orchestrator';

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
  const apiKey = resolveApiKey(config);

  log('Loading reviewers...');
  const { reviewers: allReviewers, warnings } = loadReviewersForMode(repoPath, 'audit', config);
  warnings.forEach(warning => log(`Warning: ${warning}`));

  log('Indexing repository...');
  const index = await buildRepoIndex(repoPath, config);
  log(`Found ${index.totalFiles} files to analyze.`);

  let activeReviewers: Reviewer[];

  if (options.reviewerIds && options.reviewerIds.length > 0) {
    // Explicit selection — skip orchestrator
    activeReviewers = allReviewers.filter(r => options.reviewerIds!.includes(r.id));
    log(`Using ${activeReviewers.length} explicitly selected reviewer(s).`);
  } else {
    // AI orchestrator selects which reviewers are relevant to this repo
    log(`Selecting relevant reviewers via orchestrator (${allReviewers.length} candidates)...`);
    try {
      const orchestratorResult = await selectAuditReviewers(
        index,
        allReviewers,
        config.model,
        apiKey,
        config.transport,
        config.apiBaseUrl,
      );
      const selectedIds = new Set(orchestratorResult.selectedReviewers.map(r => r.reviewerId));
      activeReviewers = allReviewers.filter(r => selectedIds.has(r.id));
      log(`Orchestrator selected ${activeReviewers.length} reviewer(s): ${activeReviewers.map(r => r.name).join(', ')}`);
    } catch {
      log('Orchestrator failed, falling back to all reviewers.');
      activeReviewers = allReviewers;
    }
  }

  if (activeReviewers.length === 0) {
    throw new Error('No reviewers found. Built-in reviewers should load automatically; add custom reviewers to .codeowl/reviewers if needed.');
  }

  const runtime = await dependencies.getRuntime();
  const reviewerResults: ReviewerResult[] = [];

  for (const reviewer of activeReviewers) {
    log(`Running reviewer: ${reviewer.name}...`);
    const result = await runSingleReviewer(reviewer, index, config, apiKey, runtime);
    reviewerResults.push(result);
    log(`  ✓ ${reviewer.name}: score=${result.score}, findings=${result.findings.length}`);
  }

  // Cross-reviewer deduplication
  const allFindings = reviewerResults.flatMap(r => r.findings);
  const deduped = deduplicateAuditFindings(allFindings);
  const droppedCount = allFindings.length - deduped.length;
  if (droppedCount > 0) log(`Deduplication removed ${droppedCount} cross-reviewer duplicate finding(s).`);

  // Rebuild per-reviewer result arrays using deduped findings
  const dedupedIdSet = new Set(deduped.map(f => f.id));
  const finalReviewerResults = reviewerResults.map(rr => ({
    ...rr,
    findings: rr.findings.filter(f => dedupedIdSet.has(f.id)),
  }));

  const overallScore = computeOverallScore(finalReviewerResults);
  const totalFindings = deduped.length;
  const criticalCount = deduped.filter(f => f.priority === 'critical').length;

  const result: AuditResult = {
    command: 'audit',
    repoPath: path.resolve(repoPath),
    overallScore,
    summary: buildAuditSummary(overallScore, totalFindings, criticalCount, activeReviewers.length),
    reviewerResults: finalReviewerResults,
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
    throw new Error(`Reviewer ${reviewer.id} failed: ${(err as Error).message}`, { cause: err });
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
      warnings: [],
    },
  };
}

/**
 * Score thresholds for generating audit summary messages.
 * Each entry has a minimum score and a message factory given
 * (totalFindings, criticalCount, reviewerCount). Evaluated top-to-bottom;
 * the first threshold whose min is ≤ the score wins.
 */
const SCORE_THRESHOLDS: Array<{ min: number; message: (t: number, c: number, r: number) => string }> = [
  { min: 90, message: (t, _c, r) => `Excellent code health. ${t} minor findings across ${r} reviewers.` },
  { min: 75, message: (t, c, r) => `Good code health with ${t} findings across ${r} reviewers. ${c > 0 ? `${c} critical issues require attention.` : 'No critical issues.'}` },
  { min: 50, message: (t, c, r) => `Code quality needs improvement. ${t} findings across ${r} reviewers, including ${c} critical issues.` },
  { min: 0,  message: (t, c, r) => `Significant issues detected. ${t} findings across ${r} reviewers, with ${c} critical issues that should be addressed immediately.` },
];

/**
 * Cross-reviewer deduplication for audit findings.
 * If two findings from different reviewers target the same file + overlapping lines
 * with similar titles (Jaccard >= 0.4), drop the lower-priority one.
 */
function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean));
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  const intersection = [...a].filter(x => b.has(x));
  const union = new Set([...a, ...b]);
  return intersection.length / union.size;
}

function linesOverlap(s1: number, e1: number, s2: number, e2: number, tolerance = 3): boolean {
  return s1 <= e2 + tolerance && s2 <= e1 + tolerance;
}

const PRIORITY_ORDER: Record<string, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

export function deduplicateAuditFindings(findings: Finding[]): Finding[] {
  const dropped = new Set<number>();

  for (let i = 0; i < findings.length; i++) {
    if (dropped.has(i)) continue;
    const a = findings[i];

    for (let j = i + 1; j < findings.length; j++) {
      if (dropped.has(j)) continue;
      const b = findings[j];

      if (
        a.filePath !== b.filePath ||
        a.reviewerId === b.reviewerId ||
        !linesOverlap(a.startLine, a.endLine, b.startLine, b.endLine)
      ) continue;

      const similarity = jaccardSimilarity(tokenize(a.title), tokenize(b.title));
      if (similarity >= 0.4) {
        const aPri = PRIORITY_ORDER[a.priority] ?? 0;
        const bPri = PRIORITY_ORDER[b.priority] ?? 0;
        dropped.add(aPri >= bPri ? j : i);
      }
    }
  }

  return findings.filter((_, i) => !dropped.has(i));
}

export function buildAuditSummary(score: number, totalFindings: number, criticalCount: number, reviewerCount: number): string {
  const threshold = SCORE_THRESHOLDS.find(t => score >= t.min) ?? SCORE_THRESHOLDS[SCORE_THRESHOLDS.length - 1];
  return threshold.message(totalFindings, criticalCount, reviewerCount);
}
