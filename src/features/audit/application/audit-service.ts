import * as fs from 'fs';
import * as path from 'path';
import { AuditResult, Finding, Reviewer, ReviewerResult } from '../../../types/index';
import { buildRepoIndex, formatFilesForContext, scopeFilesForReviewer } from '../../../core/indexing/index';
import { reviewerAnalysisSchema, ReviewerAnalysis } from '../../../core/validation/schemas';
import { buildAuditSystemPrompt, buildAuditUserMessage } from '../../../core/prompts/audit';
import { computeOverallScore } from '../../../core/scoring/normalizer';
import { runReviewerTool } from '../../../core/tools/runner';
import { formatToolContext } from '../../../core/tools/format';
import {
  AUDIT_OUTPUT_FILE,
  OUTPUT_DIR,
  MAX_FILES_FOR_REVIEWER_CONTEXT,
  MAX_CHARS_PER_REVIEWER_FILE,
  MAX_CONCURRENT_AUDIT_REVIEWERS,
  MAX_AUDIT_REVIEWER_TOKENS,
} from '../../../core/config/defaults';
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

/** Run a full repository audit and write the resulting report to disk. */
export async function runAudit(options: AuditOptions, dependencies: AuditDependencies = defaultDependencies): Promise<AuditResult> {
  const { repoPath, onProgress } = options;
  const log = (msg: string) => onProgress?.(msg);

  log('Loading configuration...');
  const config = resolveConfig(repoPath);
  const apiKey = resolveApiKey(config);

  log('Loading reviewers into the owlery...');
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
    log(`Asking the orchestrator to shortlist reviewers (${allReviewers.length} candidates)...`);
    try {
      const orchestratorResult = await selectAuditReviewers({
        index,
        availableReviewers: allReviewers,
        model: config.model,
        apiKey,
        transport: config.transport,
        apiBaseUrl: config.apiBaseUrl,
      });
      const selectedIds = new Set(orchestratorResult.selectedReviewers.map(r => r.reviewerId));
      activeReviewers = allReviewers.filter(r => selectedIds.has(r.id));
      log(`Orchestrator selected ${activeReviewers.length} reviewer(s): ${activeReviewers.map(r => r.name).join(', ')}`);
    } catch (err) {
      log(`Orchestrator stumbled (${(err as Error).message}); falling back to the full reviewer set.`);
      activeReviewers = allReviewers;
    }
  }

  if (activeReviewers.length === 0) {
    throw new Error('No reviewers found. Built-in reviewers should load automatically; add custom reviewers to .codeowl/reviewers if needed.');
  }

  const runtime = await dependencies.getRuntime();
  log(`Running ${activeReviewers.length} reviewer(s) with concurrency ${Math.min(MAX_CONCURRENT_AUDIT_REVIEWERS, activeReviewers.length)}...`);
  const reviewerResults = await runReviewersWithConcurrency(
    activeReviewers,
    MAX_CONCURRENT_AUDIT_REVIEWERS,
    async reviewer => {
      log(`Running reviewer: ${reviewer.name}...`);
      try {
        const result = await runSingleReviewer(reviewer, index, config, apiKey, runtime);
        log(`  ✓ ${reviewer.name}: score=${result.score}, findings=${result.findings.length}`);
        return result;
      } catch (err) {
        log(`  Warning: reviewer ${reviewer.name} failed and will be skipped: ${(err as Error).message}`);
        return null;
      }
    },
  );
  const successfulReviewerResults = reviewerResults.filter((result): result is ReviewerResult => result !== null);

  if (successfulReviewerResults.length === 0) {
    throw new Error('All reviewers failed. Check model/provider configuration or reviewer output constraints.');
  }

  // Cross-reviewer deduplication
  const allFindings = successfulReviewerResults.flatMap(r => r.findings);
  const deduped = deduplicateAuditFindings(allFindings);
  const droppedCount = allFindings.length - deduped.length;
  if (droppedCount > 0) log(`Deduplication removed ${droppedCount} cross-reviewer duplicate finding(s).`);

  // Rebuild per-reviewer result arrays using deduped findings
  const dedupedIdSet = new Set(deduped.map(f => f.id));
  const finalReviewerResults = successfulReviewerResults.map(rr => ({
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
  log(`Audit report written to ${outputPath}`);

  return result;
}

async function runReviewersWithConcurrency<TInput, TOutput>(
  items: TInput[],
  maxConcurrency: number,
  worker: (item: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
  if (items.length === 0) return [];

  const concurrency = Math.max(1, Math.min(maxConcurrency, items.length));
  const results = new Array<TOutput>(items.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) {
        return;
      }

      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => runWorker()));
  return results;
}

async function runSingleReviewer(
  reviewer: Reviewer,
  index: import('../../../types/index').RepoIndex,
  config: ReturnType<typeof resolveConfig>,
  apiKey: string,
  runtime: IRuntime,
): Promise<ReviewerResult> {
  const start = Date.now();
  const scopedFiles = scopeFilesForReviewer(index, reviewer.scopeHints);
  const filesContext = formatFilesForContext(scopedFiles, MAX_FILES_FOR_REVIEWER_CONTEXT, MAX_CHARS_PER_REVIEWER_FILE);
  const model = reviewer.model || config.model;

  // Run external tool if configured
  let toolContext: string | undefined;
  let toolRan = false;
  let toolDurationMs: number | undefined;
  let toolError: string | undefined;

  let toolOutput: string | undefined;

  if (reviewer.tool) {
    const toolResult = await runReviewerTool(reviewer.tool, index.repoPath);
    toolRan = true;
    toolDurationMs = toolResult.durationMs;

    if (toolResult.success || toolResult.stdout.length > 0) {
      toolContext = formatToolContext(reviewer.name, toolResult);
      toolOutput = toolResult.stdout;
    } else {
      toolError = toolResult.error;
      if (!reviewer.tool.optional) {
        throw new Error(`Required tool for ${reviewer.id} failed: ${toolResult.error}`);
      }
    }
  }

  const systemPrompt = buildAuditSystemPrompt(reviewer.instructions, reviewer.id, reviewer.name);
  const userMessage = buildAuditUserMessage(filesContext, index.totalFiles, scopedFiles.length, toolContext);

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
        maxTokens: MAX_AUDIT_REVIEWER_TOKENS,
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
  })).filter(finding => isActionableAuditFinding(reviewer, finding, index));

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
      toolRan,
      toolDurationMs,
      toolError,
      toolOutput,
    },
  };
}

function isActionableAuditFinding(
  reviewer: Reviewer,
  finding: Finding,
  index: import('../../../types/index').RepoIndex,
): boolean {
  const normalizedPath = normalizeRepoPath(finding.filePath);

  // Filter 1: skip findings pointing at generated output directories
  if (isGeneratedArtifactPath(normalizedPath)) return false;

  // Filter 2: skip findings pointing at paths that don't exist in the repo
  const absolutePath = path.resolve(index.repoPath, normalizedPath);
  if (!fs.existsSync(absolutePath) && !isKnownRepoMetadataPath(normalizedPath)) return false;

  // Filter 3: skip dependency placement noise (package in wrong dep block but present in source)
  if (shouldDropDependencyPlacementNoiseFinding(reviewer, finding, index.files)) return false;

  // Filter 4: skip speculative coverage gap findings from QA reviewers
  if (reviewer.category === 'qa' && isSpeculativeCoverageGap(finding)) return false;

  return true;
}

function shouldDropDependencyPlacementNoiseFinding(
  reviewer: Reviewer,
  finding: Finding,
  files: import('../../../types/index').RepoFile[],
): boolean {
  if (reviewer.category !== 'dependency' || !looksLikeDependencyPlacementFinding(finding)) {
    return false;
  }

  const packageNames = extractMentionedPackageNames(finding);
  return packageNames.some(packageName => packageAppearsInSource(packageName, files));
}

function normalizeRepoPath(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
}

function isGeneratedArtifactPath(relativePath: string): boolean {
  return /^(dist|build|coverage|\.codeowl\/out)(\/|$)/.test(relativePath);
}

function isKnownRepoMetadataPath(relativePath: string): boolean {
  return ['README.md', 'package.json', 'package-lock.json', '.env.example'].includes(relativePath);
}

function looksLikeDependencyPlacementFinding(finding: Finding): boolean {
  const text = `${finding.title}\n${finding.description}\n${finding.recommendation}`.toLowerCase();
  return text.includes('devdependencies') || text.includes('production dependencies') || text.includes('production dependency');
}

function extractMentionedPackageNames(finding: Finding): string[] {
  const text = [finding.title, finding.description, finding.recommendation, ...finding.evidence].join('\n');
  const matches = text.matchAll(/['"`](@?[\w./-]+)['"`]/g);
  const names = new Set<string>();

  for (const match of matches) {
    const candidate = match[1];
    if (candidate && (!candidate.includes('/') || candidate.startsWith('@'))) {
      names.add(candidate);
    }
  }

  const manifestMatch = text.match(/"(@?[\w./-]+)"\s*:/);
  if (manifestMatch) {
    names.add(manifestMatch[1]);
  }

  return [...names];
}

function packageAppearsInSource(packageName: string, files: import('../../../types/index').RepoFile[]): boolean {
  const normalized = packageName.toLowerCase();
  return files
    .filter(file => file.relativePath.startsWith('src/') && /\.(ts|tsx|js|jsx|json|md)$/i.test(file.relativePath))
    .some(file => readFileSafely(file.absolutePath).toLowerCase().includes(normalized));
}

function readFileSafely(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

function isSpeculativeCoverageGap(finding: Finding): boolean {
  const text = `${finding.title}\n${finding.description}\n${finding.recommendation}`.toLowerCase();
  return (
    finding.filePath.startsWith('test/')
    && (
      text.includes('no e2e tests')
      || text.includes('not a substitute for e2e')
      || text.includes('payment flows')
      || text.includes('signup')
      || text.includes('checkout')
      || text.includes('authentication flows')
      || text.includes('no tests found')
    )
  );
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
 * Two findings are considered duplicates when their title token overlap reaches
 * this Jaccard similarity threshold (40%). Chosen empirically: low enough to catch
 * paraphrases, high enough to avoid false positives between unrelated issues.
 */
const DUPLICATE_SIMILARITY_THRESHOLD = 0.4;

/**
 * Line numbers within this many lines of each other are treated as overlapping
 * for the purpose of cross-reviewer deduplication.
 */
const LINE_OVERLAP_TOLERANCE = 3;

/**
 * Cross-reviewer deduplication for audit findings.
 * If two findings from different reviewers target the same file + overlapping lines
 * with similar titles (Jaccard >= DUPLICATE_SIMILARITY_THRESHOLD), drop the lower-priority one.
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

function linesOverlap(s1: number, e1: number, s2: number, e2: number, tolerance = LINE_OVERLAP_TOLERANCE): boolean {
  return s1 <= e2 + tolerance && s2 <= e1 + tolerance;
}

const PRIORITY_ORDER: Record<string, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

function deduplicateAuditFindings(findings: Finding[]): Finding[] {
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
      if (similarity >= DUPLICATE_SIMILARITY_THRESHOLD) {
        const aPri = PRIORITY_ORDER[a.priority] ?? 0;
        const bPri = PRIORITY_ORDER[b.priority] ?? 0;
        dropped.add(aPri >= bPri ? j : i);
      }
    }
  }

  return findings.filter((_, i) => !dropped.has(i));
}

function buildAuditSummary(score: number, totalFindings: number, criticalCount: number, reviewerCount: number): string {
  const threshold = SCORE_THRESHOLDS.find(t => score >= t.min) ?? SCORE_THRESHOLDS[SCORE_THRESHOLDS.length - 1];
  return threshold.message(totalFindings, criticalCount, reviewerCount);
}
