import * as fs from 'fs';
import * as path from 'path';
import packageJson from '../../../../package.json';
import { AuditResult, Finding, Priority, ReviewIssue, Reviewer, ReviewerResult } from '../../../types/index';
import { buildRepoIndex, scopeFilesForReviewer, selectAuditSeedFiles } from '../../../core/indexing/index';
import { reviewerAnalysisSchema, ReviewerAnalysis } from '../../../core/validation/schemas';
import { buildAuditSystemPrompt, buildAuditUserMessage, RepoProfile } from '../../../core/prompts/audit';
import { computeOverallScore } from '../../../core/scoring/normalizer';
import { runReviewerTool } from '../../../core/tools/runner';
import { formatToolContext } from '../../../core/tools/format';
import {
  AUDIT_OUTPUT_FILE,
  OUTPUT_DIR,
  MAX_CONCURRENT_AUDIT_REVIEWERS,
  MAX_AUDIT_REVIEWER_TOKENS,
  MAX_AUDIT_REVIEWER_TIMEOUT_MS,
} from '../../../core/config/defaults';
import { ensureDir, writeAuditResult } from '../../../core/output/writer';
import { IRuntime, TokenUsage } from '../../../core/runtime/interface';
import { getAuditRuntime, createStructuredRuntime } from '../../../core/runtime/factory';
import { formatErrorWithCauses } from '../../../core/runtime/error-format';
import { addTokens, formatTokenSummary } from '../../../core/runtime/token-utils';
import { resolveApiKey, resolveConfig } from '../../config/application/config-service';
import { loadReviewersForMode } from '../../reviewers/application/reviewer-registry';
import { selectAuditReviewers } from './audit-orchestrator';
import { verifyAuditFindings } from './audit-verifier';

const CODEOWL_VERSION: string = (packageJson as { version: string }).version;

/**
 * Minimum confidence required to keep a finding, by severity.
 * Findings that fall below their tier's threshold are dropped before output.
 */
const CONFIDENCE_FLOORS: Record<Priority, number> = {
  critical: 0.75,
  high:     0.75,
  medium:   0.60,
  low:      0.50,
  info:     0.40,
};

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
  getRuntime: getAuditRuntime,
};

function truncateInline(text: string, limit: number = 120): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) return normalized;
  return normalized.slice(0, limit - 3) + '...';
}

function logAuditFindingList(log: (msg: string) => void, reviewerName: string, findings: Finding[], label: string): void {
  log(`  [${reviewerName}] ${label}: ${findings.length}`);
  if (findings.length === 0) {
    log(`  [${reviewerName}]   (none)`);
    return;
  }

  findings.forEach((finding, index) => {
    log(
      `  [${reviewerName}]   [${index + 1}/${findings.length}] ${finding.priority.toUpperCase()} ` +
      `${finding.filePath}:${finding.startLine}-${finding.endLine} "${finding.title}" ` +
      `confidence=${finding.confidence.toFixed(2)} evidence="${truncateInline(finding.evidence[0] || finding.description)}"`,
    );
  });
}

/** Run a full repository audit and write the resulting report to disk. */
export async function runAudit(options: AuditOptions, dependencies: AuditDependencies = defaultDependencies): Promise<AuditResult> {
  const { repoPath, onProgress } = options;
  const log = (msg: string) => onProgress?.(msg);

  // Phase 1: Load config and reviewers
  const { config, apiKey, allReviewers, issues } = resolveAuditConfig(options, log);

  // Phase 2: Index repository
  log('Indexing repository...');
  const index = await buildRepoIndex(repoPath, config);
  log(`Found ${index.totalFiles} files to analyze.`);

  // Phase 3: Select active reviewers via orchestrator
  let activeReviewers: Reviewer[];
  let orchestratorTokens: TokenUsage | undefined;
  let repoProfile: RepoProfile | undefined;

  if (options.reviewerIds && options.reviewerIds.length > 0) {
    activeReviewers = allReviewers.filter(r => options.reviewerIds!.includes(r.id));
    log(`Using ${activeReviewers.length} explicitly selected reviewer(s).`);
  } else {
    log(`Asking the orchestrator to shortlist reviewers (${allReviewers.length} candidates)...`);
    const orchestratorResult = await selectAuditReviewers({
      index,
      availableReviewers: allReviewers,
      model: config.model,
      apiKey,
      transport: config.transport,
      apiBaseUrl: config.apiBaseUrl,
    });
    orchestratorTokens = orchestratorResult.tokensUsed;
    repoProfile = orchestratorResult.repoProfile;
    issues.push(...orchestratorResult.issues);
    for (const issue of orchestratorResult.issues) {
      log(`! Warning: ${issue.message}`);
    }
    const selectedIds = new Set(orchestratorResult.selectedReviewers.map(r => r.reviewerId));
    activeReviewers = allReviewers.filter(r => selectedIds.has(r.id));
    log(`- Orchestrator selected ${activeReviewers.length} reviewer(s): ${activeReviewers.map(r => r.name).join(', ')}`);
  }

  if (activeReviewers.length === 0) {
    throw new Error('No reviewers found. Built-in reviewers should load automatically; add custom reviewers to .codeowl/reviewers if needed.');
  }

  // Phase 4: Run reviewers
  const runtime = await dependencies.getRuntime();
  const { successfulResults, failedCount } = await executeReviewers(
    activeReviewers, index, config, apiKey, runtime, repoProfile, issues, log,
  );

  if (successfulResults.length === 0) {
    throw new Error('All reviewers failed. Check model/provider configuration or reviewer output constraints.');
  }

  // Phase 5: Confidence floor filtering
  const rawAllFindings = successfulResults.flatMap(r => r.findings);
  const { kept: confidenceKept, dropped: confidenceDropped } = applyConfidenceFloor(rawAllFindings, log);

  // Phase 6: Cross-reviewer deduplication
  const deduplication = deduplicateAuditFindings(confidenceKept);
  const deduped = deduplication.findings;
  if (deduplication.dropped.length > 0) {
    log(`Deduplication removed ${deduplication.dropped.length} cross-reviewer duplicate finding(s).`);
    for (const dropped of deduplication.dropped) {
      log(
        `  [audit-dedup] Dropped "${dropped.dropped.title}" from ${dropped.dropped.reviewerName} ` +
        `as duplicate of ${dropped.kept.reviewerName} in ${dropped.dropped.filePath}:${dropped.dropped.startLine}-${dropped.dropped.endLine} ` +
        `(similarity=${dropped.similarity.toFixed(2)})`,
      );
    }
  }

  // Phase 7: Skeptic verification pass (filter false positives)
  log('Running skeptic verification pass...');
  let verifiedFindings = deduped;
  let semanticRejectedCount = 0;
  try {
    const verifierRuntime = await createStructuredRuntime();
    const verifierResult = await verifyAuditFindings(deduped, {
      repoPath,
      model: config.model,
      apiKey,
      transport: config.transport,
      apiBaseUrl: config.apiBaseUrl,
      runtime: verifierRuntime,
      log,
    });
    verifiedFindings = verifierResult.kept;
    semanticRejectedCount = verifierResult.rejected.length;
    if (semanticRejectedCount > 0) {
      log(`Skeptic verifier rejected ${semanticRejectedCount} finding(s) as speculative or inapplicable.`);
    }
  } catch (err) {
    log(`Warning: skeptic verifier failed, keeping all deduplicated findings: ${formatErrorWithCauses(err)}`);
  }

  // Phase 8: Rebuild per-reviewer arrays using verified findings, then assemble result
  const verifiedIdSet = new Set(verifiedFindings.map(f => f.id));
  const finalReviewerResults = successfulResults.map(rr => ({
    ...rr,
    findings: rr.findings.filter(f => verifiedIdSet.has(f.id)),
  }));

  const totalTokens = aggregateTokens(orchestratorTokens, successfulResults, log);
  if (totalTokens) {
    log(`Token usage (audit run total): ${formatTokenSummary(totalTokens)}`);
  }

  const result = assembleAuditResult({
    repoPath,
    activeReviewers,
    reviewerResults: finalReviewerResults,
    allResults: successfulResults.concat(Array(failedCount).fill(null)),
    issues,
    tokenUsage: totalTokens,
    verificationStats: {
      rawFindings: rawAllFindings.length,
      confidenceRejected: confidenceDropped,
      deterministicRejected: 0,
      semanticRejected: semanticRejectedCount,
      finalFindings: verifiedFindings.length,
    },
    failedCount,
  });

  const outputPath = options.outputPath || path.join(repoPath, AUDIT_OUTPUT_FILE);
  ensureDir(path.join(repoPath, OUTPUT_DIR));
  writeAuditResult(outputPath, result);
  log(`Audit report written to ${outputPath}`);

  return result;
}

// ---------- Helper: resolve config ----------

function resolveAuditConfig(
  options: AuditOptions,
  log: (msg: string) => void,
): { config: ReturnType<typeof resolveConfig>; apiKey: string; allReviewers: Reviewer[]; issues: ReviewIssue[] } {
  const { repoPath } = options;
  const issues: ReviewIssue[] = [];

  log('Loading configuration...');
  const config = resolveConfig(repoPath);
  const apiKey = resolveApiKey(config);

  log('Loading reviewers into the owlery...');
  const { reviewers: allReviewers, warnings } = loadReviewersForMode(repoPath, 'audit', config);
  warnings.forEach(warning => {
    log(`Warning: ${warning}`);
    issues.push({ severity: 'warning', code: 'reviewer-load-warning', message: warning, stage: 'load-reviewers' });
  });

  return { config, apiKey, allReviewers, issues };
}

// ---------- Helper: execute reviewers ----------

async function executeReviewers(
  activeReviewers: Reviewer[],
  index: import('../../../types/index').RepoIndex,
  config: ReturnType<typeof resolveConfig>,
  apiKey: string,
  runtime: IRuntime,
  repoProfile: RepoProfile | undefined,
  issues: ReviewIssue[],
  log: (msg: string) => void,
): Promise<{ successfulResults: ReviewerResult[]; failedCount: number }> {
  log(`Running ${activeReviewers.length} reviewer(s) with concurrency ${Math.min(MAX_CONCURRENT_AUDIT_REVIEWERS, activeReviewers.length)}...`);
  const reviewerResults = await runReviewersWithConcurrency(
    activeReviewers,
    MAX_CONCURRENT_AUDIT_REVIEWERS,
    async reviewer => {
      try {
        const result = await runSingleReviewer(reviewer, index, config, apiKey, runtime, repoProfile, log);
        if (result.execution.toolError) {
          issues.push({
            severity: reviewer.tool?.optional === false ? 'error' : 'warning',
            code: 'audit-reviewer-tool-error',
            message: `Tool for reviewer "${reviewer.name}" failed: ${result.execution.toolError}`,
            stage: 'reviewer-tool',
            reviewerId: reviewer.id,
            reviewerName: reviewer.name,
          });
        }
        const durationSec = (result.execution.durationMs / 1000).toFixed(1);
        const tokenSuffix = result.tokensUsed ? ` | ${formatTokenSummary(result.tokensUsed)}` : '';
        log(`  ✓ ${reviewer.name}: score=${result.score}, findings=${result.findings.length} (${durationSec}s${tokenSuffix})`);
        return result;
      } catch (err) {
        const msg = formatErrorWithCauses(err);
        const isTimeout = /timed out after/i.test(msg);
        log(`  Warning: reviewer ${reviewer.name} failed and will be skipped: ${msg}`);
        issues.push({
          severity: 'warning',
          code: isTimeout ? 'audit-reviewer-timeout' : 'audit-reviewer-failed',
          message: isTimeout
            ? `Reviewer "${reviewer.name}" (model=${reviewer.model || config.model}) timed out and was skipped: ${msg}`
            : `Reviewer "${reviewer.name}" (model=${reviewer.model || config.model}) failed and was skipped: ${msg}`,
          stage: 'run-reviewers',
          reviewerId: reviewer.id,
          reviewerName: reviewer.name,
        });
        return null;
      }
    },
  );

  const successfulResults = reviewerResults.filter((r): r is ReviewerResult => r !== null);
  const failedCount = reviewerResults.filter(r => r === null).length;
  return { successfulResults, failedCount };
}

// ---------- Helper: confidence floor ----------

function applyConfidenceFloor(
  findings: Finding[],
  log: (msg: string) => void,
): { kept: Finding[]; dropped: number } {
  const kept: Finding[] = [];
  let dropped = 0;
  for (const finding of findings) {
    const floor = CONFIDENCE_FLOORS[finding.priority] ?? 0;
    if (finding.confidence >= floor) {
      kept.push(finding);
    } else {
      dropped++;
      log(`  [confidence-filter] Dropped "${finding.title}" (${finding.priority}, confidence=${finding.confidence.toFixed(2)} < ${floor})`);
    }
  }
  return { kept, dropped };
}

// ---------- Helper: token aggregation ----------

function aggregateTokens(
  orchestratorTokens: TokenUsage | undefined,
  results: ReviewerResult[],
  log: (msg: string) => void,
): TokenUsage | undefined {
  let total: TokenUsage | undefined = orchestratorTokens ? { ...orchestratorTokens } : undefined;
  if (orchestratorTokens) {
    log(`Token usage (reviewer selection): ${formatTokenSummary(orchestratorTokens)}`);
  }
  for (const r of results) {
    if (r.tokensUsed) {
      total = total ? addTokens(total, r.tokensUsed) : { ...r.tokensUsed };
    }
  }
  return total;
}

// ---------- Helper: assemble final result ----------

function assembleAuditResult(params: {
  repoPath: string;
  activeReviewers: Reviewer[];
  reviewerResults: ReviewerResult[];
  allResults: Array<ReviewerResult | null>;
  issues: ReviewIssue[];
  tokenUsage: TokenUsage | undefined;
  verificationStats: AuditResult['verificationStats'];
  failedCount: number;
}): AuditResult {
  const { repoPath, activeReviewers, reviewerResults, issues, tokenUsage, verificationStats, failedCount } = params;

  const overallScore = computeOverallScore(reviewerResults);
  const allFinal = reviewerResults.flatMap(r => r.findings);
  const totalFindings = allFinal.length;
  const criticalCount = allFinal.filter(f => f.priority === 'critical').length;

  const majorityFailed = failedCount > activeReviewers.length / 2;
  const hasErrorIssues = issues.some(i => i.severity === 'error');
  const hasNonTransientWarnings = issues.some(i => i.severity === 'warning' && !i.code.endsWith('-timeout'));
  const runStatus: AuditResult['status'] = (hasErrorIssues || hasNonTransientWarnings || majorityFailed) ? 'degraded' : 'complete';

  return {
    command: 'audit',
    repoPath: path.resolve(repoPath),
    status: runStatus,
    overallScore,
    summary: buildAuditSummary(overallScore, totalFindings, criticalCount, activeReviewers.length),
    reviewerResults,
    issues,
    tokenUsage,
    generatedAt: new Date().toISOString(),
    codeowlVersion: CODEOWL_VERSION,
    verificationStats,
  };
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
  repoProfile: RepoProfile | undefined,
  log: (msg: string) => void,
): Promise<ReviewerResult> {
  const start = Date.now();
  const scopedFiles = scopeFilesForReviewer(index, reviewer.scopeHints);
  const seedFiles = selectAuditSeedFiles(index, reviewer, scopedFiles);
  const model = reviewer.model || config.model;
  const seedFilePaths = seedFiles.map(file => file.relativePath);
  const transportLabel = config.transport ? `, transport=${config.transport}` : '';
  log(`Running reviewer: ${reviewer.name} (model=${model}, scopedFiles=${scopedFiles.length}, seedFiles=${seedFilePaths.length}${transportLabel})...`);

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

  const systemPrompt = buildAuditSystemPrompt(reviewer.instructions, reviewer.id, reviewer.name, repoProfile);
  const userMessage = buildAuditUserMessage(
    seedFilePaths,
    index.totalFiles,
    seedFilePaths.length,
    scopedFiles.length,
    toolContext,
  );

  let analysis: ReviewerAnalysis;
  let runtimeType: import('../../../types/index').RuntimeType;
  let reviewerTokensUsed: TokenUsage | undefined;

  try {
    const result = await runtime.runAgenticReview<ReviewerAnalysis>(
      {
        systemPrompt,
        userMessage,
        model,
        apiKey,
        repoPath: index.repoPath,
        initialFiles: seedFilePaths,
        callLabel: reviewer.name,
        transport: config.transport,
        apiBaseUrl: config.apiBaseUrl,
        maxTokens: MAX_AUDIT_REVIEWER_TOKENS,
        timeoutMs: MAX_AUDIT_REVIEWER_TIMEOUT_MS,
      },
      reviewerAnalysisSchema,
    );
    analysis = result.data;
    runtimeType = result.runtime;
    reviewerTokensUsed = result.tokensUsed;
  } catch (err) {
    const msg = formatErrorWithCauses(err);
    throw new Error(`Reviewer ${reviewer.id} failed: ${msg}`, { cause: err });
  }

  const rawFindings: Finding[] = analysis.findings.map(finding => ({
    ...finding,
    reviewerId: reviewer.id,
    reviewerName: reviewer.name,
  }));
  logAuditFindingList(log, reviewer.name, rawFindings, 'Raw findings');

  const findings: Finding[] = [];
  const droppedFindings: Array<{ finding: Finding; reason: string }> = [];
  for (const finding of rawFindings) {
    const dropReason = getAuditFindingDropReason(reviewer, finding, index);
    if (dropReason) {
      droppedFindings.push({ finding, reason: dropReason });
      continue;
    }
    findings.push(finding);
  }

  if (droppedFindings.length > 0) {
    for (const dropped of droppedFindings) {
      log(`  [${reviewer.name}]   ✗ Dropped (audit-filter): "${dropped.finding.title}" — ${dropped.reason}`);
    }
  }
  logAuditFindingList(log, reviewer.name, findings, 'Post-filter findings');

  return {
    reviewerId: reviewer.id,
    reviewerName: reviewer.name,
    description: reviewer.description,
    score: analysis.score,
    summary: analysis.summary,
    findings,
    tokensUsed: reviewerTokensUsed,
    execution: {
      model,
      runtime: runtimeType,
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

function getAuditFindingDropReason(
  reviewer: Reviewer,
  finding: Finding,
  index: import('../../../types/index').RepoIndex,
): string | null {
  const normalizedPath = normalizeRepoPath(finding.filePath);

  // Filter 1: skip findings pointing at generated output directories
  if (isGeneratedArtifactPath(normalizedPath)) return 'Finding points at generated output rather than source-controlled code';

  // Filter 2: skip findings pointing at paths that don't exist in the repo
  const absolutePath = path.resolve(index.repoPath, normalizedPath);
  if (!fs.existsSync(absolutePath) && !isKnownRepoMetadataPath(normalizedPath)) {
    return 'Finding points at a path that does not exist in the current repository';
  }

  // Filter 3: skip dependency placement noise (package in wrong dep block but present in source)
  if (shouldDropDependencyPlacementNoiseFinding(reviewer, finding, index.files)) {
    return 'Dependency placement noise: package is already referenced from source code';
  }

  // Filter 4: skip speculative coverage gap findings from QA reviewers
  if (reviewer.category === 'qa' && isSpeculativeCoverageGap(finding)) {
    return 'Speculative coverage-gap finding without concrete current-repo evidence';
  }

  return null;
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
 * for the purpose of cross-reviewer deduplication. 3 lines is chosen as a
 * practical buffer: two reviewers citing the same issue may reference slightly
 * different lines (e.g. a function signature vs its first statement), but
 * typically within a few lines of each other.
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

/**
 * Returns the fraction of the shorter range that is covered by the overlap.
 * A value >= LINE_OVERLAP_FRACTION_THRESHOLD means both reviewers are
 * essentially pointing at the same large block of code.
 */
function lineOverlapFraction(s1: number, e1: number, s2: number, e2: number): number {
  const overlapStart = Math.max(s1, s2);
  const overlapEnd = Math.min(e1, e2);
  if (overlapEnd < overlapStart) return 0;
  const overlapLen = overlapEnd - overlapStart + 1;
  const minLen = Math.min(e1 - s1 + 1, e2 - s2 + 1);
  return minLen > 0 ? overlapLen / minLen : 0;
}

/**
 * When two findings overlap by >= this fraction of the shorter range, they are
 * treated as duplicates even if their titles are dissimilar. This catches cases
 * where two reviewers flag the same large function under different names.
 */
const LINE_OVERLAP_FRACTION_THRESHOLD = 0.9;

const PRIORITY_ORDER: Record<string, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

function deduplicateAuditFindings(findings: Finding[]): {
  findings: Finding[];
  dropped: Array<{ kept: Finding; dropped: Finding; similarity: number }>;
} {
  const dropped = new Set<number>();
  const droppedDiagnostics: Array<{ kept: Finding; dropped: Finding; similarity: number }> = [];

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
      const fraction = lineOverlapFraction(a.startLine, a.endLine, b.startLine, b.endLine);
      const isDuplicate = similarity >= DUPLICATE_SIMILARITY_THRESHOLD || fraction >= LINE_OVERLAP_FRACTION_THRESHOLD;
      if (isDuplicate) {
        const aPri = PRIORITY_ORDER[a.priority] ?? 0;
        const bPri = PRIORITY_ORDER[b.priority] ?? 0;
        if (aPri >= bPri) {
          dropped.add(j);
          droppedDiagnostics.push({ kept: a, dropped: b, similarity });
        } else {
          dropped.add(i);
          droppedDiagnostics.push({ kept: b, dropped: a, similarity });
        }
      }
    }
  }

  return {
    findings: findings.filter((_, i) => !dropped.has(i)),
    dropped: droppedDiagnostics,
  };
}

function buildAuditSummary(score: number, totalFindings: number, criticalCount: number, reviewerCount: number): string {
  const threshold = SCORE_THRESHOLDS.find(t => score >= t.min) ?? SCORE_THRESHOLDS[SCORE_THRESHOLDS.length - 1];
  return threshold.message(totalFindings, criticalCount, reviewerCount);
}
