import * as fs from 'fs';
import * as path from 'path';
import { PRFinding, PRReviewResult, ReviewIssue, Reviewer } from '../../types/index';
import { resolveConfig, resolveApiKey } from '../config/loader';
import { loadReviewersForMode } from '../reviewers/loader';
import { getPRReviewRuntime } from '../runtime/factory';
import { prReviewerAnalysisSchema, PRReviewerAnalysis } from '../validation/schemas';
import {
  buildPRReviewSystemPrompt,
  buildPRReviewUserMessage,
  buildPRSummaryPrompt,
} from '../prompts/pr-review';
import { getGitDiff, getChangedFiles, getCommitSummaries, getRepoOwnerAndName } from '../git/index';
import { selectReviewers } from './orchestrator';
import { writePRReviewResult, ensureDir } from '../output/writer';
import {
  MAX_PR_CURRENT_CONTEXT_CHARS,
  MAX_PR_CURRENT_FILE_CHARS,
  MAX_PR_REVIEWER_TIMEOUT_MS,
  MAX_PR_REVIEWERS,
  MAX_STRUCTURED_DIFF_CHARS,
  OUTPUT_DIR,
  PR_REVIEW_OUTPUT_FILE,
} from '../config/defaults';
import { GitHubReviewPlatform, getGitHubEnvContext } from '../github/platform';
import { parseUnifiedDiff, buildReviewerDiffContext, getFilesInDiff } from './diff-parser';
import { verifyFindings } from './verifier';
import { verifyFindingsSemantically } from './semantic-verifier';
import { deduplicateFindings } from './deduplicator';
import { buildConversation, filterAlreadyPosted, PRConversation } from './conversation';
import { IRuntime, TokenUsage } from '../runtime/interface';
import { formatErrorWithCauses } from '../runtime/error-format';
import { addTokens, formatTokenSummary } from '../runtime/token-utils';
import { runReviewerTool } from '../tools/runner';
import { formatToolContext } from '../tools/format';

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

  let comment = `${icon} **[CodeOwl ${finding.priority.toUpperCase()}] ${finding.title}**\n\n`;
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

function truncate(content: string, limit: number): string {
  if (content.length <= limit) return content;
  return content.slice(0, limit) + '\n\n[...current file truncated...]';
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

export async function runPRReviewPipeline(options: PRReviewPipelineOptions): Promise<PRReviewResult> {
  const { repoPath, onProgress } = options;
  const log = (msg: string) => onProgress?.(msg);
  const issues: ReviewIssue[] = [];

  log('Loading configuration...');
  const config = resolveConfig(repoPath);
  const apiKey = resolveApiKey(config);
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

        log('Posting review start comment...');
        await platform.publishStartComment();

        const triggerCommentId = parseInt(process.env.COMMENT_ID || '', 10);
        if (!isNaN(triggerCommentId) && triggerCommentId > 0) {
          log('Adding reaction to trigger comment...');
          await platform.addReaction(triggerCommentId, 'eyes');
        }

        log('Reading existing PR conversation...');
        const [generalComments, reviewComments] = await Promise.all([
          platform.listExistingComments(),
          platform.listReviewComments(),
        ]);
        conversation = buildConversation(generalComments, reviewComments);
        log(`Found ${conversation.codeOwlInlineComments.length} existing CodeOwl comments`);
      }
    }
  }

  log('Loading reviewers...');
  const { reviewers } = loadReviewersForMode(repoPath, 'pr-review', config);

  log('Selecting relevant reviewers...');
  const orchestratorResult = await selectReviewers(
    changedFiles,
    rawDiff,
    commits,
    reviewers,
    config.model,
    apiKey,
    config.transport,
    config.apiBaseUrl,
  );
  issues.push(...orchestratorResult.issues);

  const selectedReviewerIds = new Set(orchestratorResult.selectedReviewers.map(r => r.reviewerId));
  let selectedReviewers = reviewers.filter(r => selectedReviewerIds.has(r.id));
  if (orchestratorResult.tokensUsed) {
    log(`[token-diag] Orchestrator (${config.model}): ${formatTokenSummary(orchestratorResult.tokensUsed)}`);
  }

  // Hard cap to prevent cost explosion (e.g. orchestrator fallback or misconfigured reviewers)
  if (selectedReviewers.length > MAX_PR_REVIEWERS) {
    log(`⚠ WARNING: ${selectedReviewers.length} reviewers selected — exceeds hard cap of ${MAX_PR_REVIEWERS}. Trimming to first ${MAX_PR_REVIEWERS}.`);
    issues.push({
      severity: 'warning',
      code: 'pr-reviewer-cap-exceeded',
      message: `Reviewer count (${selectedReviewers.length}) exceeded hard cap (${MAX_PR_REVIEWERS}); only first ${MAX_PR_REVIEWERS} reviewers will run.`,
      stage: 'select-reviewers',
    });
    selectedReviewers = selectedReviewers.slice(0, MAX_PR_REVIEWERS);
  }

  log(`Selected ${selectedReviewers.length} reviewer(s): ${selectedReviewers.map(r => r.name).join(', ')}`);

  // Estimate cost BEFORE running reviewers so user sees what's about to happen
  const estInputPerReviewer = Math.round((Math.min(structuredDiff.length, MAX_STRUCTURED_DIFF_CHARS) + currentFileContext.length + 2500) / 4);
  const estTotalInput = estInputPerReviewer * selectedReviewers.length;
  log(`[token-diag] Estimated cost preview: ${selectedReviewers.length} reviewers × ~${estInputPerReviewer.toLocaleString()} input tokens/ea = ~${estTotalInput.toLocaleString()} total input tokens (agentic calls may multiply this 2-5×)`);

  const runtime = await getPRReviewRuntime();
  log(`Running ${selectedReviewers.length} agentic reviewer(s) in parallel (model: ${config.model})...`);
  log(`[token-diag] Per-reviewer estimated input context: structured diff (~${Math.round(Math.min(structuredDiff.length, MAX_STRUCTURED_DIFF_CHARS) / 4).toLocaleString()} tokens) + file context (~${Math.round(currentFileContext.length / 4).toLocaleString()} tokens) + system prompt (~600 tokens)`);

  const reviewerPromises = selectedReviewers.map(reviewer =>
    runPRReviewer(
      reviewer,
      structuredDiff,
      currentDiffFiles,
      currentFileContext,
      repoPath,
      config.model,
      apiKey,
      config.transport,
      config.apiBaseUrl,
      runtime,
      log,
    ),
  );
  const reviewerRunResults = await Promise.all(reviewerPromises);
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

  log('Running deterministic verification...');
  const deterministic = verifyFindings(allFindings, parsedDiff, repoPath);
  log(`Deterministic verification: accepted ${deterministic.verified.length}, rejected ${deterministic.rejected.length}`);

  if (deterministic.rejected.length > 0) {
    for (const rejected of deterministic.rejected.slice(0, 5)) {
      log(`  ✗ Rejected (deterministic): "${rejected.finding.title}" — ${rejected.reason}`);
    }
    if (deterministic.rejected.length > 5) {
      log(`  ... and ${deterministic.rejected.length - 5} more deterministic rejections`);
    }
  }

  log('Deduplicating verified findings...');
  const deduped = deduplicateFindings(deterministic.verified);
  log(`After dedup: ${deduped.length} findings (removed ${deterministic.verified.length - deduped.length} duplicates)`);

  // Cost optimization: skip semantic verification for high-confidence findings that
  // already passed all deterministic gates. Only send lower-confidence findings to AI.
  const HIGH_CONFIDENCE_THRESHOLD = 0.92;
  const highConfidence = deduped.filter(f => f.confidence >= HIGH_CONFIDENCE_THRESHOLD);
  const needsSemanticCheck = deduped.filter(f => f.confidence < HIGH_CONFIDENCE_THRESHOLD);
  if (highConfidence.length > 0) {
    log(`[token-diag] Skipping semantic verification for ${highConfidence.length} high-confidence (≥${HIGH_CONFIDENCE_THRESHOLD}) finding(s) — saves ~${Math.round(highConfidence.length * 800).toLocaleString()} tokens`);
  }

  let semanticVerified: PRFinding[] = [...highConfidence];
  let semanticRejectedCount = 0;
  let semanticTokens: TokenUsage | undefined;

  if (needsSemanticCheck.length > 0) {
    log(`Running semantic verification on ${needsSemanticCheck.length} finding(s)...`);
    const semantic = await verifyFindingsSemantically(needsSemanticCheck, {
      repoPath,
      runtime,
      model: config.model,
      apiKey,
      transport: config.transport,
      apiBaseUrl: config.apiBaseUrl,
      log,
    });
    issues.push(...semantic.issues);
    semanticVerified = [...highConfidence, ...semantic.verified];
    semanticRejectedCount = semantic.rejected.length;
    semanticTokens = semantic.tokensUsed;
    log(`Semantic verification: accepted ${semantic.verified.length}, rejected ${semantic.rejected.length}`);
    if (semantic.tokensUsed) {
      log(`[token-diag] Semantic verification (${config.model}): ${formatTokenSummary(semantic.tokensUsed)}`);
    }

    if (semantic.rejected.length > 0) {
      for (const rejected of semantic.rejected.slice(0, 5)) {
        log(`  ✗ Rejected (semantic): "${rejected.finding.title}" — ${rejected.reason}`);
      }
      if (semantic.rejected.length > 5) {
        log(`  ... and ${semantic.rejected.length - 5} more semantic rejections`);
      }
    }
  } else {
    log('Skipping semantic verification — all findings are high-confidence.');
  }

  let finalFindings = semanticVerified;
  if (conversation) {
    log('Filtering already-posted findings...');
    finalFindings = filterAlreadyPosted(semanticVerified, conversation);
    log(`After filter: ${finalFindings.length} new findings to post`);
  }

  const verificationStats = {
    rawFindings: allFindings.length,
    deterministicRejected: deterministic.rejected.length,
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
      ? ' ⚠ FIRST-TURN ESTIMATE — actual agentic usage is 5-20× higher'
      : '';
    log(`[token-diag] ═══ GRAND TOTAL: ${formatTokenSummary(grandTotal)}${reviewerTokensAreEstimated ? ' (⚠ UNDERESTIMATED — see reviewers line)' : ''} ═══`);
    log(`[token-diag]   orchestrator: ${orchestratorResult.tokensUsed ? formatTokenSummary(orchestratorResult.tokensUsed) : 'n/a'}`);
    log(`[token-diag]   reviewers (${selectedReviewers.length}x): ${hasTokenData ? formatTokenSummary(reviewerTokenTotal) + reviewerSuffix : 'n/a'}`);
    log(`[token-diag]   semantic verification: ${semanticTokens ? formatTokenSummary(semanticTokens) : 'skipped (high-confidence)'}`);
    if (reviewerTokensAreEstimated) {
      log(`[token-diag] ⚠ Reviewer token counts reflect the initial prompt size only. OpenCode does not`);
      log(`[token-diag]   expose cumulative session usage — each tool call re-sends the full conversation`);
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
    rejectedFindings: verificationStats.deterministicRejected + verificationStats.semanticRejected,
    verificationStats,
    tokenUsage: hasGrandTotalData ? grandTotal : undefined,
    generatedAt: new Date().toISOString(),
  };

  if (platform && !options.dryRun) {
    log(`Posting ${finalFindings.length} inline comments to GitHub...`);

    const postedFindings: PRFinding[] = [];
    for (const finding of finalFindings) {
      const posted = await platform.publishInlineComment({
        body: formatFindingComment(finding),
        path: finding.filePath,
        line: finding.startLine,
      });
      if (posted) postedFindings.push(finding);
    }

    if (postedFindings.length < finalFindings.length) {
      log(`Warning: ${finalFindings.length - postedFindings.length} comment(s) could not be posted (line not in diff or GitHub API error).`);
      issues.push({
        severity: 'warning',
        code: 'pr-inline-comment-post-failed',
        message: `${finalFindings.length - postedFindings.length} inline comment(s) could not be posted to GitHub.`,
        stage: 'publish-comments',
      });
    }

    result.verificationStats = {
      ...verificationStats,
      finalFindings: postedFindings.length,
    };
    result.status = issues.length > 0 ? 'degraded' : 'complete';
    result.summary = buildPRSummaryPrompt(postedFindings, result.status, issues, result.verificationStats, toolSummaries);
    result.findings = postedFindings;

    log('Updating summary comment...');
    await platform.updateOrCreateSummary(result.summary);

    const statusBody = result.status === 'degraded'
      ? `<!-- codeowl-status -->\n🦉 **CodeOwl** review completed with warnings — ${postedFindings.length} findings posted.`
      : `<!-- codeowl-status -->\n🦉 **CodeOwl** review complete — ${postedFindings.length} findings posted.`;
    await platform.updateStatusComment(statusBody);

    if (config.prReview?.autoApprove?.enabled && result.status === 'complete') {
      const maxSev = config.prReview.autoApprove.maxSeverity || 'low';
      const threshold = SEVERITY_ORDER[maxSev] ?? 1;
      const hasBlocker = postedFindings.some(f => SEVERITY_ORDER[f.priority] > threshold);

      if (!hasBlocker) {
        log('Auto-approving PR (no findings exceed threshold)...');
        const approved = await platform.approvePR(
          `🦉 **CodeOwl Auto-Approve**: No findings above "${maxSev}" severity. ✅`
        );
        if (approved) {
          result.autoApproved = true;
        } else {
          const failMsg = '⚠️  Auto-approve failed — enable **Settings → Actions → General → "Allow GitHub Actions to create and approve pull requests"** in this repository.';
          log(failMsg);
          await platform.updateStatusComment(
            `<!-- codeowl-status -->\n🦉 **CodeOwl** review complete — ${postedFindings.length} findings posted.\n\n${failMsg}`
          );
        }
      } else {
        log(`Auto-approve skipped — findings exceed "${maxSev}" threshold.`);
      }
    } else if (config.prReview?.autoApprove?.enabled && result.status !== 'complete') {
      log('Auto-approve skipped — review completed with warnings.');
    }

    log('✓ GitHub comments posted');
  } else {
    result.summary = buildPRSummaryPrompt(finalFindings, result.status, issues, verificationStats, toolSummaries);
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
  structuredDiff: string,
  currentDiffFiles: string[],
  currentFileContext: string,
  repoPath: string,
  model: string,
  apiKey: string,
  transport: string,
  apiBaseUrl: string | undefined,
  runtime: IRuntime,
  log: (msg: string) => void
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

  const systemPrompt = buildPRReviewSystemPrompt(reviewer.instructions, reviewer.id, reviewer.name);
  const userMessage = buildPRReviewUserMessage(structuredDiff, currentDiffFiles, currentFileContext, toolContext);
  const initialFiles = currentDiffFiles;

  try {
    log(`  Running reviewer: ${reviewer.name} (model=${reviewer.model || model}, changedFiles=${currentDiffFiles.length}, seededFiles=${initialFiles.length})...`);
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
