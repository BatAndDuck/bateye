import * as fs from 'fs';
import * as path from 'path';
import { PRFinding, PRReviewResult, ReviewIssue, Reviewer, Priority } from '../../types/index';
import { buildRepoProfile } from '../../features/audit/application/audit-orchestrator';
import { RepoProfile } from '../prompts/audit';
import { resolveConfig, resolveApiKey } from '../config/loader';
import { loadReviewersForMode } from '../reviewers/loader';
import { getPRReviewRuntime } from '../runtime/factory';
import {
  prReviewerAnalysisSchema,
  PRReviewerAnalysis,
  prBundleAnalysisSchema,
  PRBundleAnalysis,
} from '../validation/schemas';
import {
  buildPRReviewSystemPrompt,
  buildPRReviewUserMessage,
  buildPRBundleSystemPrompt,
  buildPRSummaryPrompt,
} from '../prompts/pr-review';
import { buildExecutionPlan, ExecutionGroup } from './bundle-planner';
import { getGitDiff, getChangedFiles, getCommitSummaries, getRepoOwnerAndName, CommitSummary } from '../git/index';
import { selectReviewers } from './orchestrator';
import { writePRReviewResult, ensureDir } from '../output/writer';
import {
  MAX_CONCURRENT_PR_REVIEWERS,
  MAX_ORCHESTRATOR_TIMEOUT_MS,
  MAX_PR_CURRENT_CONTEXT_CHARS,
  MAX_PR_CURRENT_FILE_CHARS,
  MAX_PR_REVIEWER_TIMEOUT_MS,
  MAX_PR_REVIEWER_RETRY_CONCURRENCY,
  MAX_PR_REVIEWER_RETRIES,
  MAX_STRUCTURED_DIFF_CHARS,
  OUTPUT_DIR,
  PR_REVIEW_OUTPUT_FILE,
  BATEYE_BREAKING_CHANGES_MARKER,
} from '../config/defaults';
import { GitHubReviewPlatform, getGitHubEnvContext } from '../github/platform';
import { parseUnifiedDiff, buildReviewerDiffContext, getFilesInDiff } from './diff-parser';
import { verifyFindings, verifyFindingsAgainstDiff } from './verifier';
import { verifyFindingsSemantically } from './semantic-verifier';
import { deduplicateFindings } from './deduplicator';
import { buildConversation, filterAlreadyPosted, PRConversation } from './conversation';
import { IRuntime, TokenUsage } from '../runtime/interface';
import { formatErrorWithCauses } from '../runtime/error-format';
import { addTokens, formatTokenSummary } from '../runtime/token-utils';
import { runReviewerTool } from '../tools/runner';
import { formatToolContext } from '../tools/format';
import { logPrompt } from '../output/prompt-logger';

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
    const token = options.githubToken || process.env.GITHUB_TOKEN;
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

  // Validate that the agentic runtime is available before calling the orchestrator.
  // This surfaces errors like "cannot use BATEYE_RUNTIME=direct" immediately.
  const runtime = await getPRReviewRuntime();

  log('Loading reviewers...');
  const { reviewers } = loadReviewersForMode(repoPath, 'pr-review', config);

  // Build the reasoning-override list once. Includes config.model plus every reviewer's
  // model override, deduped by model id.
  //   reasoningEffort (scalar) — passed to structured calls (orchestrator, semantic
  //     verifier); those use DirectAIRuntime which reads options.reasoningEffort directly.
  //   reasoningOverrides (list) — consumed only by OpenCodeCLIRuntime, which needs every
  //     model name upfront so it can seed opencode.json before spawning its server.
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

  // Each orchestrator attempt has MAX_ORCHESTRATOR_TIMEOUT_MS; up to 3 attempts total.
  const orchestratorTimeoutSec = Math.round(MAX_ORCHESTRATOR_TIMEOUT_MS / 1000);
  log(`Selecting relevant reviewers... (model: ${config.model}, timeout: ${orchestratorTimeoutSec}s/attempt)`);
  // Heartbeat so CI logs don't appear frozen while waiting for the model response.
  const heartbeat = setInterval(() => log('  - Still waiting for reviewer selection (model is thinking)...'), 30_000);
  let orchestratorResult;
  try {
    orchestratorResult = await selectReviewers(
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

  const selectedReviewerIds = new Set(orchestratorResult.selectedReviewers.map(r => r.reviewerId));
  const selectedReviewers = reviewers.filter(r => selectedReviewerIds.has(r.id));
  if (orchestratorResult.tokensUsed) {
    log(`[token-diag] Orchestrator (${config.model}): ${formatTokenSummary(orchestratorResult.tokensUsed)}`);
  }

  log(`Selected ${selectedReviewers.length} reviewer(s): ${selectedReviewers.map(r => r.name).join(', ')}`);

  // Estimate cost BEFORE running reviewers so user sees what's about to happen
  const estInputPerReviewer = Math.round((Math.min(structuredDiff.length, MAX_STRUCTURED_DIFF_CHARS) + currentFileContext.length + 2500) / 4);
  const estTotalInput = estInputPerReviewer * selectedReviewers.length;
  log(`[token-diag] Estimated cost preview: ${selectedReviewers.length} reviewers × ~${estInputPerReviewer.toLocaleString()} input tokens/ea = ~${estTotalInput.toLocaleString()} total input tokens (agentic calls may multiply this 2-5×)`);

  const concurrency = Math.min(MAX_CONCURRENT_PR_REVIEWERS, selectedReviewers.length);
  log(`Running ${selectedReviewers.length} agentic reviewer(s) with concurrency ${concurrency} (model: ${config.model})...`);
  log(`[token-diag] Per-reviewer estimated input context: structured diff (~${Math.round(Math.min(structuredDiff.length, MAX_STRUCTURED_DIFF_CHARS) / 4).toLocaleString()} tokens) + file context (~${Math.round(currentFileContext.length / 4).toLocaleString()} tokens) + system prompt (~600 tokens)`);

  const intentSummary = orchestratorResult.intentSummary;

  const sharedCtx: BundleSharedContext = {
    structuredDiff,
    currentDiffFiles,
    currentFileContext,
    commits,
    repoPath,
    model: config.model,
    apiKey,
    repoProfile,
    transport: config.transport,
    apiBaseUrl: config.apiBaseUrl,
    runtime,
    log,
    promptLogDir,
    intentSummary,
    reasoningEffort,
    reasoningOverrides,
  };

  const executionPlan = buildExecutionPlan(selectedReviewers, orchestratorResult.executionPlan);
  log(
    `Execution plan: ${executionPlan.length} group(s): ${executionPlan
      .map(g => `${g.groupId}[${g.mode}](${g.reviewers.map(r => r.name).join('+')})`)
      .join(', ')}`,
  );

  // Track in-flight groups for the heartbeat. Entries are added when a group starts
  // and removed when it finishes, so the heartbeat always shows the live state.
  const inFlight = new Map<string, { label: string; startMs: number }>();
  const groupHeartbeat = setInterval(() => {
    if (inFlight.size === 0) return;
    const parts = [...inFlight.values()].map(g => {
      const elapsedSec = Math.round((Date.now() - g.startMs) / 1000);
      return `${g.label} (${elapsedSec}s)`;
    });
    log(`  - Still waiting on ${inFlight.size} group(s): ${parts.join(', ')}`);
  }, 30_000);

  let bundleResults: PRReviewerRunResult[][];
  try {
    bundleResults = await runWithConcurrency(
      executionPlan,
      MAX_CONCURRENT_PR_REVIEWERS,
      group => {
        const label = group.reviewers.length === 1
          ? group.reviewers[0].name
          : `bundle:${group.groupId}`;
        inFlight.set(group.groupId, { label, startMs: Date.now() });
        return runPRBundle(group, sharedCtx).finally(() => inFlight.delete(group.groupId));
      },
    );
  } finally {
    clearInterval(groupHeartbeat);
  }
  let reviewerRunResults: PRReviewerRunResult[] = bundleResults.flat();

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

    // Map each failed run result back to its source Reviewer by id. Bundle execution
    // can split a group's reviewers across multiple PRReviewerRunResult entries, so we
    // cannot index into `selectedReviewers` directly anymore. Use reviewerId (stable
    // unique key) rather than reviewerName to avoid mismatches when two reviewers share
    // the same display name.
    const reviewerById = new Map(selectedReviewers.map(r => [r.id, r]));
    const failedReviewers = failedIndices
      .map(i => reviewerById.get(reviewerRunResults[i].reviewerId))
      .filter((r): r is Reviewer => r !== undefined);

    if (failedReviewers.length === 0) break;

    log(`Retrying ${failedReviewers.length} failed reviewer(s) (round ${retryRound}/${MAX_PR_REVIEWER_RETRIES}, concurrency ${MAX_PR_REVIEWER_RETRY_CONCURRENCY}): ${failedReviewers.map(r => r.name).join(', ')}`);

    // On retry, isolate every reviewer into its own single-reviewer group. This forces
    // runPRBundle to short-circuit to runPRReviewer, which keeps retry semantics identical
    // to the pre-bundle implementation.
    const retryGroups: ExecutionGroup[] = failedReviewers.map(r => ({
      groupId: `retry-${r.id}-r${retryRound}`,
      mode: 'standard',
      reason: `Retry round ${retryRound} for reviewer "${r.name}"`,
      reviewers: [r],
    }));

    const retryBundles = await runWithConcurrency(
      retryGroups,
      MAX_PR_REVIEWER_RETRY_CONCURRENCY,
      group => runPRBundle(group, sharedCtx),
    );
    const retryResults = retryBundles.flat();

    // Replace failed results with retry results (successful or not).
    // Mutable replacement: update the array in place.
    reviewerRunResults = [...reviewerRunResults];
    for (let j = 0; j < failedIndices.length; j++) {
      if (retryResults[j]) {
        reviewerRunResults[failedIndices[j]] = retryResults[j];
      }
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
  // This runs deterministically (no LLM) and prevents non-diff findings from reaching
  // the expensive semantic verifier.
  log('Running diff-gate verification...');
  const diffGate = verifyFindingsAgainstDiff(deterministic.verified, parsedDiff);
  log(`Diff-gate: accepted ${diffGate.verified.length}, rejected ${diffGate.rejected.length}`);

  if (diffGate.rejected.length > 0) {
    for (const rejected of diffGate.rejected) {
      log(`  ✗ Rejected (diff-gate): "${rejected.finding.title}" - ${rejected.reason}`);
    }
  }

  log('Deduplicating verified findings...');
  const deduped = deduplicateFindings(diffGate.verified);
  log(`After dedup: ${deduped.length} findings (removed ${diffGate.verified.length - deduped.length} duplicates)`);
  logPRFindingList(log, deduped, 'Pre-semantic findings detail');

  let semanticVerified: PRFinding[] = [];
  let semanticRejectedCount = 0;
  let semanticTokens: TokenUsage | undefined;

  const semanticEnabled = config.prReview?.semanticVerification?.enabled !== false;

  if (deduped.length > 0 && semanticEnabled) {
    log(`Running semantic verification on ${deduped.length} finding(s)...`);
    const semantic = await verifyFindingsSemantically(deduped, {
      repoPath,
      parsedDiff,
      runtime,
      model: config.model,
      apiKey,
      transport: config.transport,
      apiBaseUrl: config.apiBaseUrl,
      log,
      promptLogDir,
      reasoningEffort: reasoningEffort,
      reasoningOverrides,
    });
    issues.push(...semantic.issues);
    semanticVerified = semantic.verified;
    semanticRejectedCount = semantic.rejected.length;
    semanticTokens = semantic.tokensUsed;
    log(`Semantic verification: accepted ${semantic.verified.length}, rejected ${semantic.rejected.length}`);
    if (semantic.tokensUsed) {
      log(`[token-diag] Semantic verification (${config.model}): ${formatTokenSummary(semantic.tokensUsed)}`);
    }

    if (semantic.rejected.length > 0) {
      for (const rejected of semantic.rejected) {
        log(`  ✗ Rejected (semantic): "${rejected.finding.title}" - ${rejected.reason}`);
      }
    }
  } else if (!semanticEnabled) {
    log('Skipping semantic verification - disabled via config (prReview.semanticVerification.enabled: false).');
    semanticVerified = deduped;
  } else {
    log('Skipping semantic verification - no findings remain after deterministic/schema validation and deduplication.');
  }

  let finalFindings = semanticVerified;
  if (conversation) {
    log('Filtering already-posted findings...');
    finalFindings = filterAlreadyPosted(semanticVerified, conversation);
    log(`After filter: ${finalFindings.length} new findings to post`);
  }

  const verificationStats = {
    rawFindings: allFindings.length,
    confidenceRejected: allFindings.length - confidenceKept.length,
    deterministicRejected: deterministic.rejected.length,
    diffGateRejected: diffGate.rejected.length,
    semanticRejected: semanticRejectedCount,
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
  if (semanticTokens) {
    grandTotal = addTokens(grandTotal, semanticTokens);
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
    log(`[token-diag]   semantic verification: ${semanticTokens ? formatTokenSummary(semanticTokens) : 'skipped (no findings)'}`);
    if (reviewerTokensAreEstimated) {
      log(`[token-diag] ⚠ Reviewer token counts reflect the initial prompt size only. OpenCode does not`);
      log(`[token-diag]   expose cumulative session usage - each tool call re-sends the full conversation`);
      log(`[token-diag]   history, so true input tokens per reviewer ≈ initial_tokens × number_of_turns.`);
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
    rejectedFindings: verificationStats.deterministicRejected + verificationStats.diffGateRejected + verificationStats.semanticRejected,
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
  reviewerId: string;
  reviewerName: string;
  hasTool: boolean;
  toolRan: boolean;
  toolError?: string;
  issues: ReviewIssue[];
  tokensUsed?: TokenUsage;
}

async function runPRReviewer(
  reviewer: Reviewer,
  structuredDiff: string,
  currentDiffFiles: string[],
  currentFileContext: string,
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
        ? currentDiffFiles
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
      return { findings: [], reviewerId: reviewer.id, reviewerName: reviewer.name, hasTool: true, toolRan: false, toolError: toolResult.error, issues };
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

  const systemPrompt = buildPRReviewSystemPrompt(reviewer.instructions, reviewer.id, reviewer.name, repoProfile);
  const userMessage = buildPRReviewUserMessage(structuredDiff, currentDiffFiles, currentFileContext, toolContext, commits, intentSummary);
  const initialFiles = currentDiffFiles;

  if (promptLogDir) {
    logPrompt(promptLogDir, `reviewer-${reviewer.id}`, systemPrompt, userMessage);
  }

  try {
    log(`  Running reviewer: ${reviewer.name} (model=${reviewer.model || model}, changedFiles=${currentDiffFiles.length}, seededFiles=${initialFiles.length}, timeout=${Math.round(MAX_PR_REVIEWER_TIMEOUT_MS / 1000)}s)...`);
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
        callLabel: `reviewer:${reviewer.name}`,
        agent: 'bateye-review',
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
    return { findings, reviewerId: reviewer.id, reviewerName: reviewer.name, hasTool: !!reviewer.tool, toolRan, toolError, issues, tokensUsed: runResult.tokensUsed };
  } catch (err) {
    const msg = formatErrorWithCauses(err);
    const isTimeout = /timed out after/i.test(msg);
    log(`  ✗ ${reviewer.name} failed: ${msg}`);
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
    return { findings: [], reviewerId: reviewer.id, reviewerName: reviewer.name, hasTool: !!reviewer.tool, toolRan, toolError, issues };
  }
}

/**
 * Shared inputs that every reviewer in a PR review call needs. Passed to `runPRBundle`
 * so it can either delegate to the per-reviewer path or build a bundle prompt without
 * re-threading 15 positional parameters.
 */
interface BundleSharedContext {
  structuredDiff: string;
  currentDiffFiles: string[];
  currentFileContext: string;
  commits: CommitSummary[];
  repoPath: string;
  model: string;
  apiKey: string;
  repoProfile: RepoProfile;
  transport: string;
  apiBaseUrl: string | undefined;
  runtime: IRuntime;
  log: (msg: string) => void;
  promptLogDir?: string;
  intentSummary?: string;
  reasoningEffort?: string;
  reasoningOverrides?: Array<{ model: string; reasoningEffort: string }>;
}

/**
 * Run a single execution group. Groups of length 1, or groups whose sole reviewer has a
 * `tool` or `model` override, fall through to the existing per-reviewer path so tool
 * injection and model routing behave exactly as they did before bundling.
 *
 * Multi-reviewer groups share one agentic OpenCode session driven by
 * `buildPRBundleSystemPrompt`. Findings are attributed back to their source reviewer
 * via the required `reviewerId` field on every bundle finding; any finding whose
 * reviewerId does not match a reviewer in the group is logged and dropped (treated
 * as a schema violation rather than a hard error so one bad attribution does not
 * lose the rest of the bundle's findings).
 *
 * Token usage is split proportionally by findings-count when the model reports it;
 * the split is flagged as `estimated: true` so downstream diagnostics do not present
 * it as measured per-reviewer data.
 */
async function runPRBundle(
  group: ExecutionGroup,
  ctx: BundleSharedContext,
): Promise<PRReviewerRunResult[]> {
  // Single-reviewer groups and any group containing a tool reviewer fall back to the
  // per-reviewer path. Tool output is injected per-reviewer into the user message and
  // cannot safely be merged into a shared session without leaking tool context.
  if (group.reviewers.length === 1 || group.reviewers.some(r => r.tool)) {
    // The bundle-planner already isolates tool reviewers, so this path should only
    // fire for length === 1. Defensive fallthrough for the unexpected case.
    const results: PRReviewerRunResult[] = [];
    for (const reviewer of group.reviewers) {
      const result = await runPRReviewer(
        reviewer,
        ctx.structuredDiff,
        ctx.currentDiffFiles,
        ctx.currentFileContext,
        ctx.commits,
        ctx.repoPath,
        ctx.model,
        ctx.apiKey,
        ctx.repoProfile,
        ctx.transport,
        ctx.apiBaseUrl,
        ctx.runtime,
        ctx.log,
        ctx.promptLogDir,
        ctx.intentSummary,
        ctx.reasoningEffort,
        ctx.reasoningOverrides,
      );
      results.push(result);
    }
    return results;
  }

  const { log } = ctx;
  const reviewerById = new Map(group.reviewers.map(r => [r.id, r]));
  const reviewerNames = group.reviewers.map(r => r.name).join(', ');
  const bundleLabel = `bundle:${group.groupId}`;
  const agentName = group.mode === 'deep' ? 'bateye-review-deep' : 'bateye-review';

  const systemPrompt = buildPRBundleSystemPrompt(
    group.reviewers.map(r => ({ id: r.id, name: r.name, instructions: r.instructions })),
    ctx.repoProfile,
  );
  const userMessage = buildPRReviewUserMessage(
    ctx.structuredDiff,
    ctx.currentDiffFiles,
    ctx.currentFileContext,
    undefined,
    ctx.commits,
    ctx.intentSummary,
  );

  if (ctx.promptLogDir) {
    logPrompt(ctx.promptLogDir, `bundle-${group.groupId}`, systemPrompt, userMessage);
  }

  // Scale the timeout with bundle size because the prompt is larger and the model is
  // producing more structured output. Cap at 3× to avoid unbounded stalls.
  const scale = Math.min(group.reviewers.length, 3);
  const timeoutMs = MAX_PR_REVIEWER_TIMEOUT_MS * scale;

  try {
    log(`  Running bundle: ${group.groupId} [${group.mode}] (${group.reviewers.length} reviewers: ${reviewerNames}, agent=${agentName}, timeout=${Math.round(timeoutMs / 1000)}s)...`);
    const runResult = await ctx.runtime.runAgenticReview<PRBundleAnalysis>(
      {
        systemPrompt,
        userMessage,
        model: ctx.model,
        apiKey: ctx.apiKey,
        repoPath: ctx.repoPath,
        initialFiles: ctx.currentDiffFiles,
        transport: ctx.transport,
        apiBaseUrl: ctx.apiBaseUrl,
        maxTokens: 8096,
        temperature: 0,
        timeoutMs,
        callLabel: bundleLabel,
        agent: agentName,
        reasoningEffort: ctx.reasoningEffort,
        reasoningOverrides: ctx.reasoningOverrides,
      },
      prBundleAnalysisSchema,
    );

    // Bucket findings by reviewerId. Findings whose reviewerId is not in the group are
    // dropped (logged as a schema-violation warning) rather than silently reattributed.
    const findingsByReviewer = new Map<string, PRFinding[]>();
    for (const reviewer of group.reviewers) {
      findingsByReviewer.set(reviewer.id, []);
    }
    let strayFindings = 0;
    for (const f of runResult.data.findings) {
      const source = reviewerById.get(f.reviewerId);
      if (!source) {
        strayFindings++;
        continue;
      }
      const bucket = findingsByReviewer.get(source.id)!;
      bucket.push({
        ...f,
        reviewerId: source.id,
        reviewerName: source.name,
      });
    }
    if (strayFindings > 0) {
      log(`  ⚠ Bundle ${group.groupId}: dropped ${strayFindings} finding(s) with unknown reviewerId`);
    }

    // Map `perReviewer` entries by id so we can attach summaries/scores to the run
    // results. Absent entries are fine — downstream code tolerates missing per-reviewer
    // metadata, and `deduplicateFindings` + scoring operate on the flat finding list.
    const perReviewerById = new Map(runResult.data.perReviewer.map(p => [p.reviewerId, p]));

    // Proportional token split by findings count. When findings sum to zero we fall
    // back to an even split. In either case we flag the result as `estimated` because
    // the provider reported one combined total for the bundle call.
    const totalFindings = runResult.data.findings.length;
    const splitTokens = (reviewerId: string): TokenUsage | undefined => {
      if (!runResult.tokensUsed) return undefined;
      const { inputTokens, outputTokens } = runResult.tokensUsed;
      if (group.reviewers.length <= 1) {
        return { inputTokens, outputTokens, estimated: true };
      }
      const weight = totalFindings === 0
        ? 1 / group.reviewers.length
        : (findingsByReviewer.get(reviewerId)?.length ?? 0) / totalFindings
            || (1 / group.reviewers.length) / 10; // tiny floor so zero-finding reviewers still attribute something
      return {
        inputTokens: Math.round(inputTokens * weight),
        outputTokens: Math.round(outputTokens * weight),
        estimated: true,
      };
    };

    const durationSec = (runResult.durationMs / 1000).toFixed(1);
    const tokenSuffix = runResult.tokensUsed
      ? ` | ${formatTokenSummary(runResult.tokensUsed)}`
      : '';
    log(`  ✓ bundle ${group.groupId}: ${totalFindings} findings across ${group.reviewers.length} reviewer(s) (${durationSec}s${tokenSuffix})`);

    return group.reviewers.map(reviewer => {
      const findings = findingsByReviewer.get(reviewer.id) ?? [];
      const perReviewer = perReviewerById.get(reviewer.id);
      if (!perReviewer) {
        log(`  ⚠ Bundle ${group.groupId}: reviewer "${reviewer.name}" missing from perReviewer array`);
      }
      return {
        findings,
        reviewerId: reviewer.id,
        reviewerName: reviewer.name,
        hasTool: false,
        toolRan: false,
        issues: [],
        tokensUsed: splitTokens(reviewer.id),
      };
    });
  } catch (err) {
    const msg = formatErrorWithCauses(err);
    const isTimeout = /timed out after/i.test(msg);
    log(`  ✗ bundle ${group.groupId} failed: ${msg}`);
    // Every reviewer in the bundle is marked failed so the retry round can reconstruct
    // 1-reviewer groups for them on the next pass.
    return group.reviewers.map(reviewer => ({
      findings: [],
      reviewerId: reviewer.id,
      reviewerName: reviewer.name,
      hasTool: !!reviewer.tool,
      toolRan: false,
      issues: [
        {
          severity: 'warning' as const,
          code: isTimeout ? 'pr-reviewer-timeout' : 'pr-reviewer-failed',
          message: isTimeout
            ? `Bundle "${group.groupId}" (reviewer "${reviewer.name}", model=${ctx.model}) timed out: ${msg}`
            : `Bundle "${group.groupId}" (reviewer "${reviewer.name}", model=${ctx.model}) failed: ${msg}`,
          stage: 'run-reviewers' as const,
          reviewerId: reviewer.id,
          reviewerName: reviewer.name,
        },
      ],
    }));
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
