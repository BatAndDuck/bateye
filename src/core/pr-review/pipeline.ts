import * as fs from 'fs';
import * as path from 'path';
import { PRFinding, PRReviewResult, ReviewIssue, Reviewer, Priority, ReviewerPlanSelection } from '../../types/index';
import { buildRepoProfile } from '../../features/audit/application/audit-orchestrator';
import { RepoProfile } from '../prompts/audit';
import { resolveConfig, resolveApiKey, resolveGitHubToken } from '../config/loader';
import { loadReviewersForMode } from '../reviewers/loader';
import { getPRReviewRuntime, getStructuredRuntime } from '../runtime/factory';
import { prReviewerAnalysisSchema, PRReviewerAnalysis } from '../validation/schemas';
import {
  buildPRReviewSystemPrompt,
  buildPRReviewUserMessage,
  buildPRSummaryPrompt,
} from '../prompts/pr-review';
import { getGitDiff, getChangedFiles, getCommitSummaries, getRepoOwnerAndName, CommitSummary } from '../git/index';
import { selectReviewers } from './orchestrator';
import { writePRReviewResult, ensureDir } from '../output/writer';
import { resolveDiagnosticDir } from '../output/diagnostics';
import {
  MAX_CONCURRENT_PR_REVIEWERS,
  MAX_PR_CURRENT_CONTEXT_CHARS,
  MAX_PR_CURRENT_FILE_CHARS,
  MAX_PR_PLANNER_TIMEOUT_MS,
  MAX_PR_REVIEWER_FILES_TO_INSPECT,
  MAX_PR_REVIEWER_TIMEOUT_MS,
  MAX_PR_REVIEWER_RETRY_CONCURRENCY,
  MAX_PR_REVIEWER_RETRIES,
  MAX_STRUCTURED_DIFF_CHARS,
  OUTPUT_DIR,
  PR_PLANNER_MAX_STEPS,
  PR_REVIEWER_MAX_STEPS,
  PR_REVIEW_OUTPUT_FILE,
  BATEYE_BREAKING_CHANGES_MARKER,
} from '../config/defaults';
import { GitHubReviewPlatform, getGitHubEnvContext } from '../github/platform';
import { parseUnifiedDiff, buildReviewerDiffContext, getFilesInDiff } from './diff-parser';
import { verifyFindings, verifyFindingsAgainstDiff } from './verifier';
import { buildFindingDedupPlan, mergeDuplicateFindings, PRFindingDuplicateDecision } from './deduplicator';
import { buildConversation, filterAlreadyPosted, PRConversation } from './conversation';
import { IRuntime, TokenUsage } from '../runtime/interface';
import { formatErrorWithCauses } from '../runtime/error-format';
import { addTokens, formatTokenSummary } from '../runtime/token-utils';
import { runReviewerTool } from '../tools/runner';
import { formatToolContext } from '../tools/format';
import { logPrompt } from '../output/prompt-logger';
import { extractCodebiteArtifactPaths, validateCodebiteAgenticModels } from '../runtime/codebite/index';
import { formatDedupArbiterError, runPRDedupArbiter } from './dedup-arbiter';

export interface PRReviewPipelineOptions {
  repoPath: string;
  baseRef?: string;
  headRef?: string;
  github?: boolean;
  githubToken?: string;
  prNumber?: number;
  dryRun?: boolean;
  onProgress?: (msg: string) => void;
}

const MIN_CURRENT_FILE_CHARS = 1_000;

const SEVERITY_ORDER: Record<string, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const CONFIDENCE_FLOORS: Record<Priority, number> = {
  critical: 0.75,
  high: 0.60,
  medium: 0.60,
  low: 0.50,
  info: 0.40,
};

/**
 * Build a lightweight RepoProfile by scanning the repo directory for
 * indicator files - no content reading required. Used in PR review where
 * a full index is not available.
 */
function buildPRRepoProfile(repoPath: string, changedFiles: string[]): RepoProfile {
  const allPaths = changedFiles.map(f => f.toLowerCase());

  // Also scan root-level files for project-type signals (non-recursive, fast)
  try {
    const rootEntries = fs.readdirSync(repoPath, { withFileTypes: true });
    for (const entry of rootEntries) {
      allPaths.push(entry.name.toLowerCase());
    }
  } catch {
    // ignore scan errors - changedFiles alone is sufficient for basic profiling
  }

  return buildRepoProfile({
    files: allPaths.map(p => ({ relativePath: p, absolutePath: path.join(repoPath, p), extension: path.extname(p), sizeBytes: 0 })),
    repoPath,
    totalFiles: allPaths.length,
  });
}

function extractTrailFiles(finding: Pick<PRFinding, 'verificationTrail'>): string[] {
  return finding.verificationTrail
    .filter(entry => entry.startsWith('file:'))
    .map(entry => entry.slice('file:'.length).trim())
    .filter(Boolean);
}

function formatFindingComment(finding: PRFinding): string {
  const icon = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢', info: 'ℹ️' }[finding.priority] || '•';
  const confidencePercent = Math.round(finding.confidence * 100);
  const inspectedFiles = extractTrailFiles(finding).slice(0, 3);

  let comment = `${icon} **[BatEye ${finding.priority.toUpperCase()}] ${finding.title}**\n\n`;
  comment += `${finding.description}\n\n`;
  comment += `**Recommendation:** ${finding.recommendation}\n\n`;

  if (finding.codeQuote) {
    comment += `\`\`\`\n${finding.codeQuote}\n\`\`\`\n\n`;
  }

  comment += `*Reviewer: ${finding.reviewerName} | Confidence: ${confidencePercent}%*`;

  if (inspectedFiles.length > 0) {
    comment += `\n\n*Verified via: ${inspectedFiles.join(', ')}*`;
  }

  return comment;
}

/**
 * Formats all breaking-change findings into a single aggregated PR comment.
 * Each finding becomes a collapsible bullet entry rather than a separate inline thread.
 */
function formatBreakingChangesComment(findings: PRFinding[]): string {
  const severityIcon = (p: string) => ({ critical: '🔴', high: '🟠', medium: '🟡', low: '🟢', info: 'ℹ️' }[p] || '•');

  const entries = findings.map((f, i) => {
    const icon = severityIcon(f.priority);
    const loc = `\`${f.filePath}:${f.startLine}\``;
    let entry = `### ${i + 1}. ${icon} ${f.title}\n\n`;
    entry += `**Location:** ${loc}\n\n`;
    entry += `${f.description}\n\n`;
    if (f.recommendation) {
      entry += `**Recommendation:** ${f.recommendation}\n\n`;
    }
    if (f.codeQuote) {
      entry += `\`\`\`\n${f.codeQuote}\n\`\`\`\n\n`;
    }
    return entry.trimEnd();
  }).join('\n\n---\n\n');

  return `${BATEYE_BREAKING_CHANGES_MARKER}
## 🦇 BatEye - Breaking Changes Detected

This PR introduces **${findings.length} breaking change${findings.length === 1 ? '' : 's'}**. These are listed here for visibility. Auto-approve is disabled until breaking changes are reviewed and resolved or explicitly acknowledged.

${entries}`;
}

function truncate(content: string, limit: number): string {
  if (content.length <= limit) return content;
  return content.slice(0, limit) + '\n\n[...current file truncated...]';
}

function truncateInline(text: string, limit: number = 120): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) return normalized;
  return normalized.slice(0, limit - 3) + '...';
}

function logPRFindingList(log: (msg: string) => void, findings: PRFinding[], label: string): void {
  log(`${label}: ${findings.length}`);
  if (findings.length === 0) {
    log('  (none)');
    return;
  }

  findings.forEach((finding, index) => {
    log(
      `  [${index + 1}/${findings.length}] ${finding.priority.toUpperCase()} ${finding.reviewerName} ` +
      `${finding.filePath}:${finding.startLine}-${finding.endLine} "${finding.title}" ` +
      `confidence=${finding.confidence.toFixed(2)} quote="${truncateInline(finding.codeQuote)}"`,
    );
  });
}

function buildCurrentFileContext(repoPath: string, currentDiffFiles: string[]): string {
  if (currentDiffFiles.length === 0) {
    return 'No readable current files were detected for this PR.';
  }

  const perFileBudget = Math.max(
    MIN_CURRENT_FILE_CHARS,
    Math.min(MAX_PR_CURRENT_FILE_CHARS, Math.floor(MAX_PR_CURRENT_CONTEXT_CHARS / currentDiffFiles.length)),
  );

  return currentDiffFiles.map(filePath => {
    const absolutePath = path.join(repoPath, filePath);
    if (!fs.existsSync(absolutePath)) {
      return `### ${filePath}\n[Current file unavailable: file does not exist in the post-change workspace]`;
    }

    try {
      const content = fs.readFileSync(absolutePath, 'utf-8');
      return `### ${filePath}\n\`\`\`\n${truncate(content, perFileBudget)}\n\`\`\``;
    } catch {
      return `### ${filePath}\n[Current file unavailable: file could not be read as text]`;
    }
  }).join('\n\n');
}

interface ReviewerExecutionContext {
  structuredDiff: string;
  changedFiles: string[];
  currentFileContext: string;
  initialFiles: string[];
  plannerSelection?: ReviewerPlanSelection;
  usingPlannerContext: boolean;
  plannerFallbackReason?: string;
}

function normalizePlannerPath(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function resolveRepoPath(repoPath: string, relativePath: string): string | null {
  const normalizedRoot = path.resolve(repoPath);
  const candidate = path.resolve(repoPath, relativePath);

  if (candidate !== normalizedRoot && !candidate.startsWith(`${normalizedRoot}${path.sep}`)) {
    return null;
  }

  return candidate;
}

function buildPlannerFallbackReason(
  plannerSelection: ReviewerPlanSelection,
  referencedPaths: string[],
  existingFiles: string[],
  focusedDiffFiles: string[],
): string {
  const reasons: string[] = [];

  if (!plannerSelection.briefing?.trim()) {
    reasons.push('planner briefing was empty');
  }
  if (referencedPaths.length === 0) {
    reasons.push('planner did not provide focused paths');
  }
  if (existingFiles.length === 0) {
    reasons.push('planner paths did not resolve to readable files');
  }
  if (focusedDiffFiles.length === 0) {
    reasons.push('planner paths did not map to changed files');
  }

  return reasons.length > 0
    ? reasons.join('; ')
    : 'planner context was too sparse to seed a focused reviewer run';
}

function resolveReviewerExecutionContext(args: {
  repoPath: string;
  parsedDiff: ReturnType<typeof parseUnifiedDiff>;
  fullStructuredDiff: string;
  fullCurrentDiffFiles: string[];
  fullCurrentFileContext: string;
  plannerSelection?: ReviewerPlanSelection;
}): ReviewerExecutionContext {
  const {
    repoPath,
    parsedDiff,
    fullStructuredDiff,
    fullCurrentDiffFiles,
    fullCurrentFileContext,
    plannerSelection,
  } = args;

  if (!plannerSelection) {
    return {
      structuredDiff: fullStructuredDiff,
      changedFiles: fullCurrentDiffFiles,
      currentFileContext: fullCurrentFileContext,
      initialFiles: fullCurrentDiffFiles.slice(0, MAX_PR_REVIEWER_FILES_TO_INSPECT),
      usingPlannerContext: false,
      plannerFallbackReason: 'no planner selection metadata was available for this reviewer',
    };
  }

  const referencedPaths = Array.from(new Set(
    [
      ...(plannerSelection.contextPaths || []),
      ...(plannerSelection.consistencyReferences || []),
      ...(plannerSelection.testLocations || []),
    ]
      .map(pathItem => normalizePlannerPath(pathItem))
      .filter(Boolean),
  ));

  const existingFiles = referencedPaths.filter(pathItem => {
    const absolutePath = resolveRepoPath(repoPath, pathItem);
    return absolutePath ? fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile() : false;
  });
  const focusedDiffFiles = getFilesInDiff(parsedDiff, referencedPaths);
  const initialFiles = Array.from(new Set([
    ...focusedDiffFiles,
    ...existingFiles,
  ])).slice(0, MAX_PR_REVIEWER_FILES_TO_INSPECT);

  if (!plannerSelection.briefing?.trim() || focusedDiffFiles.length === 0 || initialFiles.length === 0) {
    return {
      structuredDiff: fullStructuredDiff,
      changedFiles: fullCurrentDiffFiles,
      currentFileContext: fullCurrentFileContext,
      initialFiles: fullCurrentDiffFiles.slice(0, MAX_PR_REVIEWER_FILES_TO_INSPECT),
      plannerSelection,
      usingPlannerContext: false,
      plannerFallbackReason: buildPlannerFallbackReason(plannerSelection, referencedPaths, existingFiles, focusedDiffFiles),
    };
  }

  return {
    structuredDiff: buildReviewerDiffContext(parsedDiff, focusedDiffFiles),
    changedFiles: focusedDiffFiles,
    currentFileContext: buildCurrentFileContext(repoPath, focusedDiffFiles),
    initialFiles,
    plannerSelection: {
      ...plannerSelection,
      contextPaths: referencedPaths,
    },
    usingPlannerContext: true,
  };
}

async function runWithConcurrency<TInput, TOutput>(
  items: TInput[],
  maxConcurrency: number,
  worker: (item: TInput) => Promise<TOutput>,
): Promise<TOutput[]> {
  if (items.length === 0) return [];
  const concurrency = Math.max(1, Math.min(maxConcurrency, items.length));
  const results = new Array<TOutput>(items.length);
  let nextIndex = 0;
  async function runWorker(): Promise<void> {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await worker(items[i]);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, runWorker));
  return results;
}

export async function runPRReviewPipeline(options: PRReviewPipelineOptions): Promise<PRReviewResult> {
  const { repoPath, onProgress } = options;
  const log = (msg: string) => onProgress?.(msg);
  const issues: ReviewIssue[] = [];

  log('Loading configuration...');
  const config = resolveConfig(repoPath);
  const apiKey = resolveApiKey(config, repoPath);
  const diagnosticDir = resolveDiagnosticDir(repoPath);
  if (diagnosticDir) {
    log(`Diagnostics enabled. Writing PR review traces to ${diagnosticDir}`);
  }
  const baseRef = options.baseRef || 'origin/main';
  const headRef = options.headRef || 'HEAD';

  log(`Getting diff: ${baseRef}...${headRef}`);
  const rawDiff = await getGitDiff(repoPath, baseRef, headRef);
  const changedFiles = await getChangedFiles(repoPath, baseRef, headRef);
  const commits = await getCommitSummaries(repoPath, baseRef, headRef);
  log(`Changed files: ${changedFiles.length}`);
  log(`Commits in review range: ${commits.length}`);

  if (changedFiles.length === 0) {
    throw new Error('No changed files found between the specified refs.');
  }

  log('Parsing diff...');
  const parsedDiff = parseUnifiedDiff(rawDiff);
  const structuredDiff = buildReviewerDiffContext(parsedDiff);
  const currentDiffFiles = getFilesInDiff(parsedDiff);
  const currentFileContext = buildCurrentFileContext(repoPath, currentDiffFiles);
  log(`Parsed ${currentDiffFiles.length} files from diff`);
  log(`[token-diag] Raw diff: ${rawDiff.length.toLocaleString()} chars (~${Math.round(rawDiff.length / 4).toLocaleString()} tokens) | Structured diff: ${structuredDiff.length.toLocaleString()} chars (~${Math.round(structuredDiff.length / 4).toLocaleString()} tokens, capped at 24k chars for reviewer)`);
  log(`[token-diag] Current file context: ${currentFileContext.length.toLocaleString()} chars (~${Math.round(currentFileContext.length / 4).toLocaleString()} tokens) across ${currentDiffFiles.length} file(s)`);

  let platform: GitHubReviewPlatform | null = null;
  let conversation: PRConversation | null = null;

  if (options.github && !options.dryRun) {
    const token = resolveGitHubToken(config, options.githubToken);
    if (token) {
      const ghCtx = await resolveGitHubContext(options, repoPath);
      if (ghCtx) {
        platform = new GitHubReviewPlatform({
          token,
          owner: ghCtx.owner,
          repo: ghCtx.repo,
          prNumber: ghCtx.prNumber,
          repoPath,
        });

        const triggerCommentId = parseInt(process.env.COMMENT_ID || '', 10);
        if (!isNaN(triggerCommentId) && triggerCommentId > 0) {
          log('Adding reaction to trigger comment...');
          await platform.addReaction(triggerCommentId, 'eyes');
        }

        log('Posting review start comment...');
        await platform.publishStartComment();

        log('Reading existing PR conversation...');
        const [generalComments, reviewComments] = await Promise.all([
          platform.listExistingComments(),
          platform.listReviewComments(),
        ]);
        conversation = buildConversation(generalComments, reviewComments);
        log(`Found ${conversation.batEyeInlineComments.length} existing BatEye comments`);
      }
    }
  }

  // Build a lightweight repo profile from the changed files + repo root scan.
  // Used to contextualise reviewer prompts (e.g. CLI tool vs web service).
  const repoProfile = buildPRRepoProfile(repoPath, changedFiles);

  log('Loading reviewers...');
  const { reviewers } = loadReviewersForMode(repoPath, 'pr-review', config);

  if (process.env.BATEYE_RUNTIME !== 'mock') {
    validateCodebiteAgenticModels(
      [config.model, ...reviewers.map(r => r.model || config.model)].map(model => ({
        model,
        transport: config.transport,
        apiBaseUrl: config.apiBaseUrl,
      })),
    );
  }

  // Validate that the agentic runtime is available before calling the orchestrator.
  // This surfaces runtime/config errors immediately.
  const runtime = await getPRReviewRuntime();

  // Build the reasoning-override list once. Includes config.model plus every reviewer's
  // model override, deduped by model id. The list is preserved for runtime diagnostics
  // and compatibility with the existing pipeline threading.
  // Undefined when reasoningEffort isn't configured.
  // Guard against non-string values that could appear in hand-edited config files.
  const reasoningEffort = typeof config.reasoningEffort === 'string' && config.reasoningEffort
    ? config.reasoningEffort
    : undefined;
  const reasoningOverrides = reasoningEffort
    ? Array.from(new Map(
        [config.model, ...reviewers.map(r => r.model || config.model)]
          .map(m => [m, { model: m, reasoningEffort }]),
      ).values())
    : undefined;

  const promptLogDir = path.join(repoPath, OUTPUT_DIR, 'prompts');

  const plannerTimeoutSec = Math.round(MAX_PR_PLANNER_TIMEOUT_MS / 1000);
  log(`Running deep reviewer planner... (model: ${config.model}, maxSteps: ${PR_PLANNER_MAX_STEPS}, timeout: ${plannerTimeoutSec}s/attempt)`);
  // Heartbeat so CI logs don't appear frozen while waiting for the model response.
  const heartbeat = setInterval(() => log('  - Still waiting for deep planner synthesis (model is thinking)...'), 30_000);
  let orchestratorResult;
  try {
    orchestratorResult = await selectReviewers(
      repoPath,
      changedFiles,
      rawDiff,
      commits,
      reviewers,
      config.model,
      apiKey,
      config.prReview?.maxReviewers,
      config.transport,
      config.apiBaseUrl,
      promptLogDir,
      log,
      reasoningEffort,
      reasoningOverrides,
    );
  } finally {
    clearInterval(heartbeat);
  }
  issues.push(...orchestratorResult.issues);

  const reviewerById = new Map(reviewers.map(reviewer => [reviewer.id, reviewer]));
  const selectedReviewerPlans = orchestratorResult.selectedReviewers.filter(selection => reviewerById.has(selection.reviewerId));
  const selectedReviewers = selectedReviewerPlans.map(selection => reviewerById.get(selection.reviewerId) as Reviewer);
  if (orchestratorResult.tokensUsed) {
    log(`[token-diag] Planner (${config.model}): ${formatTokenSummary(orchestratorResult.tokensUsed)}`);
  }

  log(`Selected ${selectedReviewers.length} reviewer(s): ${selectedReviewers.map(r => r.name).join(', ')}`);

  const reviewerRuns = selectedReviewerPlans.map((plannerSelection, index) => ({
    reviewer: selectedReviewers[index],
    plannerSelection,
    executionContext: resolveReviewerExecutionContext({
      repoPath,
      parsedDiff,
      fullStructuredDiff: structuredDiff,
      fullCurrentDiffFiles: currentDiffFiles,
      fullCurrentFileContext: currentFileContext,
      plannerSelection,
    }),
  }));

  // Estimate cost BEFORE running reviewers so user sees what's about to happen
  const estimatedReviewerInputs = reviewerRuns.map(run =>
    Math.round((Math.min(run.executionContext.structuredDiff.length, MAX_STRUCTURED_DIFF_CHARS) + run.executionContext.currentFileContext.length + 2500) / 4)
  );
  const estAverageInputPerReviewer = estimatedReviewerInputs.length > 0
    ? Math.round(estimatedReviewerInputs.reduce((sum, value) => sum + value, 0) / estimatedReviewerInputs.length)
    : 0;
  const estTotalInput = estimatedReviewerInputs.reduce((sum, value) => sum + value, 0);
  log(`[token-diag] Estimated cost preview: ${selectedReviewers.length} reviewers × ~${estAverageInputPerReviewer.toLocaleString()} input tokens/ea = ~${estTotalInput.toLocaleString()} total input tokens (agentic calls may multiply this 2-5×)`);

  const concurrency = Math.min(MAX_CONCURRENT_PR_REVIEWERS, selectedReviewers.length);
  log(`Running ${selectedReviewers.length} agentic reviewer(s) with concurrency ${concurrency} (model: ${config.model})...`);
  log(`[token-diag] Reviewer mode: deepMode=false, maxSteps=${PR_REVIEWER_MAX_STEPS}. Planner context will narrow diff/file seeding per reviewer when usable.`);

  const intentSummary = orchestratorResult.intentSummary;

  let reviewerRunResults = await runWithConcurrency(
    reviewerRuns,
    MAX_CONCURRENT_PR_REVIEWERS,
    reviewerRun => runPRReviewer(
      reviewerRun.reviewer,
      reviewerRun.executionContext,
      commits,
      repoPath,
      config.model,
      apiKey,
      repoProfile,
      config.transport,
      config.apiBaseUrl,
      runtime,
      log,
      promptLogDir,
      intentSummary,
      reasoningEffort,
      reasoningOverrides,
    ),
  );

  // Retry failed/timed-out reviewers with reduced concurrency to avoid server saturation.
  for (let retryRound = 1; retryRound <= MAX_PR_REVIEWER_RETRIES; retryRound++) {
    const failedIndices: number[] = [];
    for (let i = 0; i < reviewerRunResults.length; i++) {
      const r = reviewerRunResults[i];
      if (r.findings.length === 0 && r.issues.some(iss => iss.code === 'pr-reviewer-timeout' || iss.code === 'pr-reviewer-failed')) {
        failedIndices.push(i);
      }
    }
    if (failedIndices.length === 0) break;

    const failedReviewerRuns = failedIndices.map(i => reviewerRuns[i]);
    log(`Retrying ${failedReviewerRuns.length} failed reviewer(s) (round ${retryRound}/${MAX_PR_REVIEWER_RETRIES}, concurrency ${MAX_PR_REVIEWER_RETRY_CONCURRENCY}): ${failedReviewerRuns.map(r => r.reviewer.name).join(', ')}`);

    const retryResults = await runWithConcurrency(
      failedReviewerRuns,
      MAX_PR_REVIEWER_RETRY_CONCURRENCY,
      reviewerRun => runPRReviewer(
        reviewerRun.reviewer,
        reviewerRun.executionContext,
        commits,
        repoPath,
        config.model,
        apiKey,
        repoProfile,
        config.transport,
        config.apiBaseUrl,
        runtime,
        log,
        promptLogDir,
        intentSummary,
        reasoningEffort,
        reasoningOverrides,
      ),
    );

    // Replace failed results with retry results (successful or not).
    // Mutable replacement: update the array in place.
    reviewerRunResults = [...reviewerRunResults];
    for (let j = 0; j < failedIndices.length; j++) {
      reviewerRunResults[failedIndices[j]] = retryResults[j];
    }
  }

  const toolSummaries = reviewerRunResults
    .filter(r => r.hasTool)
    .map(r => ({ reviewerName: r.reviewerName, toolRan: r.toolRan, findingCount: r.findings.length, error: r.toolError }));
  for (const reviewerRunResult of reviewerRunResults) {
    issues.push(...reviewerRunResult.issues);
  }

  // Aggregate token usage across all reviewer runs
  let reviewerTokenTotal: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  let hasTokenData = false;
  for (const r of reviewerRunResults) {
    if (r.tokensUsed) {
      reviewerTokenTotal = addTokens(reviewerTokenTotal, r.tokensUsed);
      hasTokenData = true;
    }
  }
  if (hasTokenData) {
    log(`[token-diag] Reviewers subtotal: ${formatTokenSummary(reviewerTokenTotal)}`);
  }

  const allFindings = reviewerRunResults.flatMap(r => r.findings);
  log(`Collected ${allFindings.length} raw findings from all reviewers`);
  logPRFindingList(log, allFindings, 'Raw findings detail');

  // Confidence floor: drop findings below the per-priority minimum threshold.
  const confidenceKept: PRFinding[] = [];
  for (const f of allFindings) {
    const floor = CONFIDENCE_FLOORS[f.priority as Priority] ?? 0.5;
    if ((f.confidence ?? 1) >= floor) {
      confidenceKept.push(f);
    } else {
      log(`  [confidence-filter] Dropped "${f.title}" (${f.priority}, confidence=${f.confidence} < ${floor})`);
    }
  }
  if (confidenceKept.length < allFindings.length) {
    log(`Confidence filter: kept ${confidenceKept.length}/${allFindings.length} findings`);
  }

  log('Running deterministic verification...');
  const deterministic = verifyFindings(confidenceKept);
  log(`Deterministic verification: accepted ${deterministic.verified.length}, rejected ${deterministic.rejected.length}`);

  if (deterministic.rejected.length > 0) {
    for (const rejected of deterministic.rejected) {
      log(`  ✗ Rejected (schema): "${rejected.finding.title}" - ${rejected.reason}`);
    }
  }

  // Diff-gate: hard-reject any finding whose anchor file/lines are not in the PR diff.
  // This runs deterministically (no LLM) and blocks clearly out-of-scope findings.
  log('Running diff-gate verification...');
  const diffGate = verifyFindingsAgainstDiff(deterministic.verified, parsedDiff);
  log(`Diff-gate: accepted ${diffGate.verified.length}, rejected ${diffGate.rejected.length}`);

  if (diffGate.rejected.length > 0) {
    for (const rejected of diffGate.rejected) {
      log(`  ✗ Rejected (diff-gate): "${rejected.finding.title}" - ${rejected.reason}`);
    }
  }

  log('Deduplicating verified findings...');
  const dedupPlan = buildFindingDedupPlan(diffGate.verified);
  const obviousDuplicateCount = dedupPlan.obviousDecisions.length;
  const ambiguousDuplicateCount = dedupPlan.ambiguousCandidates.length;
  let dedupDecisions: PRFindingDuplicateDecision[] = [...dedupPlan.obviousDecisions];
  let dedupTokensUsed: TokenUsage | undefined;

  log(
    `Dedup plan: ${obviousDuplicateCount} obvious duplicate pair(s), `
    + `${ambiguousDuplicateCount} ambiguous pair(s) for LLM review`,
  );

  if (ambiguousDuplicateCount > 0) {
    try {
      const structuredRuntime = await getStructuredRuntime();
      const dedupArbiter = await runPRDedupArbiter({
        candidates: dedupPlan.ambiguousCandidates,
        runtime: structuredRuntime,
        model: config.model,
        apiKey,
        transport: config.transport,
        apiBaseUrl: config.apiBaseUrl,
        promptLogDir,
        onLog: log,
      });

      dedupTokensUsed = dedupArbiter.tokensUsed;
      dedupDecisions = dedupDecisions.concat(
        dedupArbiter.decisions.filter(
          decision => decision.verdict === 'duplicate' && decision.confidence >= 0.8,
        ),
      );

      const llmDuplicateCount = dedupArbiter.decisions.filter(
        decision => decision.verdict === 'duplicate' && decision.confidence >= 0.8,
      ).length;
      const llmDistinctCount = dedupArbiter.decisions.filter(
        decision => decision.verdict === 'distinct',
      ).length;
      const llmUnsureCount = dedupArbiter.decisions.filter(
        decision => decision.verdict === 'unsure' || decision.confidence < 0.8,
      ).length;

      log(
        `Dedup arbiter: ${llmDuplicateCount} duplicate, ${llmDistinctCount} distinct, `
        + `${llmUnsureCount} kept separate`,
      );
      if (dedupTokensUsed) {
        log(`[token-diag] Dedup arbiter subtotal: ${formatTokenSummary(dedupTokensUsed)}`);
      }
    } catch (err) {
      log(`${formatDedupArbiterError(err)} Keeping ambiguous findings separate.`);
    }
  }

  const deduped = mergeDuplicateFindings(diffGate.verified, dedupDecisions);
  log(`After dedup: ${deduped.length} findings (removed ${diffGate.verified.length - deduped.length} duplicates)`);
  logPRFindingList(log, deduped, 'Verified findings detail');

  let finalFindings = deduped;
  if (conversation) {
    log('Filtering already-posted findings...');
    finalFindings = filterAlreadyPosted(deduped, conversation);
    log(`After filter: ${finalFindings.length} new findings to post`);
  }

  const verificationStats = {
    rawFindings: allFindings.length,
    confidenceRejected: allFindings.length - confidenceKept.length,
    deterministicRejected: deterministic.rejected.length,
    diffGateRejected: diffGate.rejected.length,
    finalFindings: finalFindings.length,
  };

  // Grand total token usage summary
  let grandTotal: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  let hasGrandTotalData = false;
  if (orchestratorResult.tokensUsed) {
    grandTotal = addTokens(grandTotal, orchestratorResult.tokensUsed);
    hasGrandTotalData = true;
  }
  if (hasTokenData) {
    grandTotal = addTokens(grandTotal, reviewerTokenTotal);
    hasGrandTotalData = true;
  }
  if (dedupTokensUsed) {
    grandTotal = addTokens(grandTotal, dedupTokensUsed);
    hasGrandTotalData = true;
  }
  if (hasGrandTotalData) {
    const reviewerTokensAreEstimated = hasTokenData && reviewerTokenTotal.estimated;
    const reviewerSuffix = reviewerTokensAreEstimated
      ? ' ⚠ FIRST-TURN ESTIMATE - actual agentic usage is 5-20× higher'
      : '';
    log(`[token-diag] ═══ GRAND TOTAL: ${formatTokenSummary(grandTotal)}${reviewerTokensAreEstimated ? ' (⚠ UNDERESTIMATED - see reviewers line)' : ''} ═══`);
    log(`[token-diag]   orchestrator: ${orchestratorResult.tokensUsed ? formatTokenSummary(orchestratorResult.tokensUsed) : 'n/a'}`);
    log(`[token-diag]   reviewers (${selectedReviewers.length}x): ${hasTokenData ? formatTokenSummary(reviewerTokenTotal) + reviewerSuffix : 'n/a'}`);
    if (dedupTokensUsed) {
      log(`[token-diag]   dedup arbiter: ${formatTokenSummary(dedupTokensUsed)}`);
    }
    if (reviewerTokensAreEstimated) {
      log('[token-diag] ⚠ Reviewer token counts are estimated for one or more agentic calls.');
      log('[token-diag]   The Codebite-backed runtime did not report complete per-step usage for every turn.');
    }
  }

  // Degrade on error-severity issues, non-transient warnings (tool failures etc.),
  // or majority reviewer failures. Transient timeouts alone don't warrant DEGRADED.
  const failedReviewerCount = reviewerRunResults.filter(r => r.findings.length === 0 && r.issues.length > 0).length;
  const majorityFailed = failedReviewerCount > selectedReviewers.length / 2;
  const hasErrorIssues = issues.some(i => i.severity === 'error');
  const hasNonTransientWarnings = issues.some(
    i => i.severity === 'warning' && !i.code.endsWith('-timeout'),
  );
  const runStatus: PRReviewResult['status'] = (hasErrorIssues || hasNonTransientWarnings || majorityFailed) ? 'degraded' : 'complete';

  const result: PRReviewResult = {
    command: 'pr-review',
    baseRef,
    headRef,
    status: runStatus,
    selectedReviewers: orchestratorResult.selectedReviewers,
    summary: '',
    findings: finalFindings,
    issues,
    rejectedFindings: verificationStats.deterministicRejected + verificationStats.diffGateRejected,
    verificationStats,
    tokenUsage: hasGrandTotalData ? grandTotal : undefined,
    generatedAt: new Date().toISOString(),
  };

  // Separate breaking-change findings: these are aggregated into a single comment
  // rather than posted as individual inline findings.
  const breakingChangeFindings = finalFindings.filter(f => f.reviewerId === 'breaking-change');
  const regularFindings = finalFindings.filter(f => f.reviewerId !== 'breaking-change');

  if (platform && !options.dryRun) {
    log(`Posting ${regularFindings.length} inline comments to GitHub...`);

    const postedFindings: PRFinding[] = [];
    for (const finding of regularFindings) {
      const posted = await platform.publishInlineComment({
        body: formatFindingComment(finding),
        path: finding.filePath,
        line: finding.startLine,
      });
      if (posted) postedFindings.push(finding);
    }

    if (postedFindings.length < regularFindings.length) {
      log(`Warning: ${regularFindings.length - postedFindings.length} comment(s) could not be posted (line not in diff or GitHub API error).`);
      issues.push({
        severity: 'warning',
        code: 'pr-inline-comment-post-failed',
        message: `${regularFindings.length - postedFindings.length} inline comment(s) could not be posted to GitHub.`,
        stage: 'publish-comments',
      });
    }

    // Post or update the aggregated breaking-changes comment when present.
    if (breakingChangeFindings.length > 0) {
      log(`Posting aggregated breaking-changes comment (${breakingChangeFindings.length} finding(s))...`);
      const breakingBody = formatBreakingChangesComment(breakingChangeFindings);
      await platform.updateOrCreateBreakingChangesComment(breakingBody);
    }

    result.verificationStats = {
      ...verificationStats,
      // Count both posted inline findings and breaking-change findings in the total
      finalFindings: postedFindings.length + breakingChangeFindings.length,
    };
    result.status = issues.length > 0 ? 'degraded' : 'complete';
    const allReportedFindings = [...postedFindings, ...breakingChangeFindings];
    result.summary = buildPRSummaryPrompt(allReportedFindings, result.status, issues, result.verificationStats, toolSummaries);
    result.findings = allReportedFindings;

    log('Updating summary comment...');
    await platform.updateOrCreateSummary(result.summary);

    const statusBody = result.status === 'degraded'
      ? `<!-- bateye-status -->\n🦇 **BatEye** review completed with warnings - ${postedFindings.length} findings posted.`
      : `<!-- bateye-status -->\n🦇 **BatEye** review complete - ${postedFindings.length} findings posted.`;
    await platform.updateStatusComment(statusBody);

    const hasBreakingChanges = breakingChangeFindings.length > 0;
    if (config.prReview?.autoApprove?.enabled && result.status === 'complete') {
      const maxSev = config.prReview.autoApprove.maxSeverity || 'low';
      const threshold = SEVERITY_ORDER[maxSev] ?? 1;
      const hasBlocker = postedFindings.some(f => SEVERITY_ORDER[f.priority] > threshold);

      if (hasBreakingChanges) {
        log('Auto-approve skipped - breaking changes detected.');
      } else if (!hasBlocker) {
        log('Auto-approving PR (no findings exceed threshold)...');
        const approved = await platform.approvePR(
          `🦇 **BatEye Auto-Approve**: No findings above "${maxSev}" severity. ✅`
        );
        if (approved) {
          result.autoApproved = true;
        } else {
          const failMsg = '⚠️  Auto-approve failed - enable **Settings → Actions → General → "Allow GitHub Actions to create and approve pull requests"** in this repository.';
          log(failMsg);
          await platform.updateStatusComment(
            `<!-- bateye-status -->\n🦇 **BatEye** review complete - ${postedFindings.length} findings posted.\n\n${failMsg}`
          );
        }
      } else {
        log(`Auto-approve skipped - findings exceed "${maxSev}" threshold.`);
      }
    } else if (config.prReview?.autoApprove?.enabled && result.status !== 'complete') {
      log('Auto-approve skipped - review completed with warnings.');
    }

    log('✓ GitHub comments posted');
  } else {
    const allReportedFindings = [...regularFindings, ...breakingChangeFindings];
    result.summary = buildPRSummaryPrompt(allReportedFindings, result.status, issues, verificationStats, toolSummaries);
  }

  const outputPath = path.join(repoPath, PR_REVIEW_OUTPUT_FILE);
  ensureDir(path.join(repoPath, OUTPUT_DIR));
  writePRReviewResult(outputPath, result);

  return result;
}

interface PRReviewerRunResult {
  findings: PRFinding[];
  reviewerName: string;
  hasTool: boolean;
  toolRan: boolean;
  toolError?: string;
  issues: ReviewIssue[];
  tokensUsed?: TokenUsage;
}

async function runPRReviewer(
  reviewer: Reviewer,
  executionContext: ReviewerExecutionContext,
  commits: CommitSummary[],
  repoPath: string,
  model: string,
  apiKey: string,
  repoProfile: RepoProfile,
  transport: string,
  apiBaseUrl: string | undefined,
  runtime: IRuntime,
  log: (msg: string) => void,
  promptLogDir?: string,
  intentSummary?: string,
  reasoningEffort?: string,
  reasoningOverrides?: Array<{ model: string; reasoningEffort: string }>,
): Promise<PRReviewerRunResult> {
  const issues: ReviewIssue[] = [];
  let toolContext: string | undefined;
  let toolRan = false;
  let toolError: string | undefined;

  if (reviewer.tool) {
    const targetFiles =
      reviewer.tool.targeting === 'file' && reviewer.tool.fileArgs
        ? executionContext.changedFiles
        : undefined;

    const toolResult = await runReviewerTool(reviewer.tool, repoPath, targetFiles);
    toolRan = true;

    if (toolResult.success || toolResult.stdout.length > 0) {
      toolContext = formatToolContext(reviewer.name, toolResult);
    } else if (!reviewer.tool.optional) {
      log(`  ✗ Required tool for ${reviewer.name} failed: ${toolResult.error}`);
      issues.push({
        severity: 'warning',
        code: 'pr-reviewer-required-tool-failed',
        message: `Required tool for reviewer "${reviewer.name}" failed: ${toolResult.error}`,
        stage: 'reviewer-tool',
        reviewerId: reviewer.id,
        reviewerName: reviewer.name,
      });
      return { findings: [], reviewerName: reviewer.name, hasTool: true, toolRan: false, toolError: toolResult.error, issues };
    } else {
      toolError = toolResult.error;
      toolRan = false;
      log(`  ⚠ Tool for ${reviewer.name} failed (continuing investigation): ${toolResult.error}`);
      issues.push({
        severity: 'warning',
        code: 'pr-reviewer-optional-tool-failed',
        message: `Optional tool for reviewer "${reviewer.name}" failed: ${toolResult.error}`,
        stage: 'reviewer-tool',
        reviewerId: reviewer.id,
        reviewerName: reviewer.name,
      });
    }
  }

  if (executionContext.plannerSelection && !executionContext.usingPlannerContext) {
    log(`  ⚠ ${reviewer.name}: falling back to broader PR context because planner paths were not usable (${executionContext.plannerFallbackReason})`);
    issues.push({
      severity: 'warning',
      code: 'pr-reviewer-planner-context-fallback',
      message: `Planner context for reviewer "${reviewer.name}" was too sparse, so BatEye fell back to the broader PR context: ${executionContext.plannerFallbackReason}`,
      stage: 'reviewer-planner-context',
      reviewerId: reviewer.id,
      reviewerName: reviewer.name,
    });
  }

  const systemPrompt = buildPRReviewSystemPrompt(reviewer.instructions, reviewer.id, reviewer.name, repoProfile);
  const userMessage = buildPRReviewUserMessage({
    structuredDiff: executionContext.structuredDiff,
    changedFiles: executionContext.changedFiles,
    currentFileContext: executionContext.currentFileContext,
    toolContext,
    commits,
    intentSummary,
    plannerSelection: executionContext.plannerSelection,
    usingPlannerContext: executionContext.usingPlannerContext,
    plannerFallbackReason: executionContext.plannerFallbackReason,
  });
  const initialFiles = executionContext.initialFiles;

  if (promptLogDir) {
    logPrompt(promptLogDir, `reviewer-${reviewer.id}`, systemPrompt, userMessage);
  }

  try {
    log(`  Running reviewer: ${reviewer.name} (model=${reviewer.model || model}, changedFiles=${executionContext.changedFiles.length}, seededFiles=${initialFiles.length}, maxSteps=${PR_REVIEWER_MAX_STEPS}, plannerScoped=${executionContext.usingPlannerContext})...`);
    const runResult = await runtime.runAgenticReview<PRReviewerAnalysis>(
      {
        systemPrompt,
        userMessage,
        model: reviewer.model || model,
        apiKey,
        repoPath,
        initialFiles,
        transport,
        apiBaseUrl,
        maxTokens: 8096,
        temperature: 0,
        timeoutMs: MAX_PR_REVIEWER_TIMEOUT_MS,
        maxSteps: PR_REVIEWER_MAX_STEPS,
        deepMode: false,
        disableSubagents: false,
        callLabel: `reviewer:${reviewer.name}`,
        reasoningEffort,
        reasoningOverrides,
      },
      prReviewerAnalysisSchema,
    );

    const findings: PRFinding[] = runResult.data.findings.map(f => ({
      ...f,
      reviewerId: reviewer.id,
      reviewerName: reviewer.name,
    }));

    const durationSec = (runResult.durationMs / 1000).toFixed(1);
    const tokenSuffix = runResult.tokensUsed
      ? ` | ${formatTokenSummary(runResult.tokensUsed)}`
      : '';
    log(`  ✓ ${reviewer.name}: ${findings.length} findings (${durationSec}s${tokenSuffix})`);
    return { findings, reviewerName: reviewer.name, hasTool: !!reviewer.tool, toolRan, toolError, issues, tokensUsed: runResult.tokensUsed };
  } catch (err) {
    const msg = formatErrorWithCauses(err);
    const isTimeout = /timed out after/i.test(msg);
    log(`  ✗ ${reviewer.name} failed: ${msg}`);
    const artifactPaths = extractCodebiteArtifactPaths(err);
    if (artifactPaths.length > 0) {
      log(`  - ${reviewer.name} diagnostics: ${artifactPaths.join(', ')}`);
    }
    issues.push({
      severity: isTimeout ? 'warning' : 'warning',
      code: isTimeout ? 'pr-reviewer-timeout' : 'pr-reviewer-failed',
      message: isTimeout
        ? `Reviewer "${reviewer.name}" (model=${reviewer.model || model}) timed out: ${msg}`
        : `Reviewer "${reviewer.name}" (model=${reviewer.model || model}) failed: ${msg}`,
      stage: 'run-reviewers',
      reviewerId: reviewer.id,
      reviewerName: reviewer.name,
    });
    return { findings: [], reviewerName: reviewer.name, hasTool: !!reviewer.tool, toolRan, toolError, issues };
  }
}

async function resolveGitHubContext(
  options: PRReviewPipelineOptions,
  repoPath: string
): Promise<{ owner: string; repo: string; prNumber: number } | null> {
  const envCtx = getGitHubEnvContext();
  if (envCtx) return envCtx;

  if (!options.prNumber) {
    console.warn('Warning: --pr-number is required for GitHub comments outside of GitHub Actions.');
    return null;
  }

  const repoInfo = await getRepoOwnerAndName(repoPath);
  if (repoInfo) {
    return { owner: repoInfo.owner, repo: repoInfo.repo, prNumber: options.prNumber };
  }

  return null;
}
