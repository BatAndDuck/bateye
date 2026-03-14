import * as path from 'path';
import { PRFinding, PRReviewResult, Reviewer } from '../../types/index';
import { resolveConfig, resolveApiKey } from '../config/loader';
import { loadReviewersForMode } from '../reviewers/loader';
import { getRuntime } from '../runtime/factory';
import { prReviewerAnalysisSchema, PRReviewerAnalysis } from '../validation/schemas';
import {
  buildPRReviewSystemPrompt,
  buildPRReviewUserMessage,
  buildPRSummaryPrompt,
} from '../prompts/pr-review';
import { getGitDiff, getChangedFiles, getRepoOwnerAndName } from '../git/index';
import { selectReviewers } from './orchestrator';
import { writePRReviewResult, ensureDir } from '../output/writer';
import { PR_REVIEW_OUTPUT_FILE, OUTPUT_DIR } from '../config/defaults';
import { GitHubReviewPlatform, getGitHubEnvContext } from '../github/platform';
import { parseUnifiedDiff, buildReviewerDiffContext, getFilesInDiff } from './diff-parser';
import { verifyFindings } from './verifier';
import { deduplicateFindings } from './deduplicator';
import { buildConversation, filterAlreadyPosted, PRConversation } from './conversation';
import { IRuntime } from '../runtime/interface';
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

const SEVERITY_ORDER: Record<string, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function formatFindingComment(finding: PRFinding): string {
  const icon = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢', info: 'ℹ️' }[finding.priority] || '•';
  const confidencePercent = Math.round(finding.confidence * 100);

  let comment = `${icon} **[CodeOwl ${finding.priority.toUpperCase()}] ${finding.title}**\n\n`;
  comment += `${finding.description}\n\n`;
  comment += `**Recommendation:** ${finding.recommendation}\n\n`;

  if (finding.codeQuote) {
    comment += `\`\`\`\n${finding.codeQuote}\n\`\`\`\n\n`;
  }

  comment += `*Reviewer: ${finding.reviewerName} | Confidence: ${confidencePercent}%*`;

  return comment;
}

export async function runPRReviewPipeline(options: PRReviewPipelineOptions): Promise<PRReviewResult> {
  const { repoPath, onProgress } = options;
  const log = (msg: string) => onProgress?.(msg);

  // ─── Stage 1: Load config ───
  log('Loading configuration...');
  const config = resolveConfig(repoPath);
  const apiKey = resolveApiKey(config);
  const baseRef = options.baseRef || 'origin/main';
  const headRef = options.headRef || 'HEAD';

  // ─── Stage 2: Get diff and parse it ───
  log(`Getting diff: ${baseRef}...${headRef}`);
  const rawDiff = await getGitDiff(repoPath, baseRef, headRef);
  const changedFiles = await getChangedFiles(repoPath, baseRef, headRef);
  log(`Changed files: ${changedFiles.length}`);

  if (changedFiles.length === 0) {
    throw new Error('No changed files found between the specified refs.');
  }

  log('Parsing diff...');
  const parsedDiff = parseUnifiedDiff(rawDiff);
  const structuredDiff = buildReviewerDiffContext(parsedDiff);
  const filesInDiff = getFilesInDiff(parsedDiff);
  log(`Parsed ${filesInDiff.length} files from diff`);

  // ─── Stage 3: GitHub setup (start comment + reaction + conversation) ───
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

        // Post start comment
        log('Posting review start comment...');
        await platform.publishStartComment();

        // Add eyes reaction to /review trigger comment
        const triggerCommentId = parseInt(process.env.COMMENT_ID || '', 10);
        if (!isNaN(triggerCommentId) && triggerCommentId > 0) {
          log('Adding reaction to trigger comment...');
          await platform.addReaction(triggerCommentId, 'eyes');
        }

        // Read existing conversation
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

  // ─── Stage 4: Orchestrator - select reviewers ───
  log('Loading reviewers...');
  const { reviewers } = loadReviewersForMode(repoPath, 'pr-review', config);

  log('Selecting relevant reviewers...');
  const orchestratorResult = await selectReviewers(
    changedFiles,
    rawDiff,
    reviewers,
    config.model,
    apiKey,
    config.transport,
    config.apiBaseUrl,
  );

  const selectedReviewerIds = new Set(orchestratorResult.selectedReviewers.map(r => r.reviewerId));
  const selectedReviewers = reviewers.filter(r => selectedReviewerIds.has(r.id));
  log(`Selected ${selectedReviewers.length} reviewer(s): ${selectedReviewers.map(r => r.name).join(', ')}`);

  // ─── Stage 5: Run reviewer agents (parallel) ───
  const runtime = await getRuntime();
  log('Running reviewers in parallel...');

  const reviewerPromises = selectedReviewers.map(reviewer =>
    runPRReviewer(reviewer, structuredDiff, changedFiles, repoPath, config.model, apiKey, config.transport, config.apiBaseUrl, runtime, log)
  );
  const reviewerRunResults = await Promise.all(reviewerPromises);
  const toolSummaries = reviewerRunResults
    .filter(r => r.hasTool)
    .map(r => ({ reviewerName: r.reviewerName, toolRan: r.toolRan, findingCount: r.findings.length, error: r.toolError }));
  const allFindings = reviewerRunResults.flatMap(r => r.findings);
  log(`Collected ${allFindings.length} raw findings from all reviewers`);

  // ─── Stage 6: Evidence verification ───
  log('Verifying findings against diff...');
  const { verified, rejected } = verifyFindings(allFindings, parsedDiff);
  log(`Verified: ${verified.length}, Rejected: ${rejected.length}`);

  if (rejected.length > 0) {
    for (const r of rejected.slice(0, 5)) {
      log(`  ✗ Rejected: "${r.finding.title}" — ${r.reason}`);
    }
    if (rejected.length > 5) {
      log(`  ... and ${rejected.length - 5} more rejected`);
    }
  }

  // ─── Stage 7: Deduplication ───
  log('Deduplicating findings...');
  const deduped = deduplicateFindings(verified);
  log(`After dedup: ${deduped.length} findings (removed ${verified.length - deduped.length} duplicates)`);

  // ─── Stage 8: Filter already-posted comments ───
  let finalFindings = deduped;
  if (conversation) {
    log('Filtering already-posted findings...');
    finalFindings = filterAlreadyPosted(deduped, conversation);
    log(`After filter: ${finalFindings.length} new findings to post`);
  }

  // ─── Stage 9: Build result ───
  // Summary is finalised after posting so the counts reflect what GitHub actually accepted.
  const result: PRReviewResult = {
    command: 'pr-review',
    baseRef,
    headRef,
    selectedReviewers: orchestratorResult.selectedReviewers,
    summary: '',        // filled in after stage 10
    findings: finalFindings,
    rejectedFindings: rejected.length,
    generatedAt: new Date().toISOString(),
  };

  // ─── Stage 10: Post to GitHub ───
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
    }

    // Build summary from findings that were actually posted so counts are accurate
    const summary = buildPRSummaryPrompt(postedFindings, rejected.length, toolSummaries);
    result.summary = summary;
    result.findings = postedFindings;

    // Update or create summary comment
    log('Updating summary comment...');
    await platform.updateOrCreateSummary(summary);

    // Update status comment to show completion
    const statusBody = `<!-- codeowl-status -->\n🦉 **CodeOwl** review complete — ${postedFindings.length} findings posted.`;
    await platform.updateStatusComment(statusBody);

    // Auto-approve if configured and threshold met.
    // Use `postedFindings` (what was actually reported in this run) for the threshold check.
    // This ensures that already-posted findings from previous runs don't permanently block
    // auto-approval on re-runs — what matters is whether THIS run's new findings exceed the threshold.
    if (config.prReview?.autoApprove?.enabled) {
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
          log('⚠️  Auto-approve failed. To fix: go to GitHub repo Settings → General → "Allow GitHub Actions to create and approve pull requests" and enable it.');
        }
      } else {
        log(`Auto-approve skipped — findings exceed "${maxSev}" threshold.`);
      }
    }

    log(`✓ GitHub comments posted`);
  } else {
    // Dry-run or no platform — use all finalFindings for the summary
    result.summary = buildPRSummaryPrompt(finalFindings, rejected.length, toolSummaries);
  }

  // Write local artifact after summary is finalised
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
}

async function runPRReviewer(
  reviewer: Reviewer,
  structuredDiff: string,
  changedFiles: string[],
  repoPath: string,
  model: string,
  apiKey: string,
  transport: string,
  apiBaseUrl: string | undefined,
  runtime: IRuntime,
  log: (msg: string) => void
): Promise<PRReviewerRunResult> {
  // Run external tool if configured
  let toolContext: string | undefined;
  let toolRan = false;
  let toolError: string | undefined;

  if (reviewer.tool) {
    const targetFiles =
      reviewer.tool.targeting === 'file' && reviewer.tool.fileArgs
        ? changedFiles
        : undefined;

    const toolResult = await runReviewerTool(reviewer.tool, repoPath, targetFiles);
    toolRan = true;

    if (toolResult.success || toolResult.stdout.length > 0) {
      toolContext = formatToolContext(reviewer.name, toolResult);
    } else if (!reviewer.tool.optional) {
      log(`  ✗ Required tool for ${reviewer.name} failed: ${toolResult.error}`);
      return { findings: [], reviewerName: reviewer.name, hasTool: true, toolRan: false, toolError: toolResult.error };
    } else {
      toolError = toolResult.error;
      toolRan = false;
      log(`  ⚠ Tool for ${reviewer.name} failed (continuing AI-only): ${toolResult.error}`);
    }
  }

  const systemPrompt = buildPRReviewSystemPrompt(reviewer.instructions, reviewer.id, reviewer.name);
  const userMessage = buildPRReviewUserMessage(structuredDiff, changedFiles, toolContext);

  try {
    log(`  Running reviewer: ${reviewer.name}...`);
    const runResult = await runtime.run<PRReviewerAnalysis>(
      {
        systemPrompt,
        userMessage,
        model: reviewer.model || model,
        apiKey,
        transport,
        apiBaseUrl,
        maxTokens: 8096,
        temperature: 0,
      },
      prReviewerAnalysisSchema
    );

    const findings: PRFinding[] = runResult.data.findings.map(f => ({
      ...f,
      reviewerId: reviewer.id,
      reviewerName: reviewer.name,
    }));

    log(`  ✓ ${reviewer.name}: ${findings.length} findings`);
    return { findings, reviewerName: reviewer.name, hasTool: !!reviewer.tool, toolRan, toolError };
  } catch (err) {
    log(`  ✗ ${reviewer.name} failed: ${(err as Error).message}`);
    return { findings: [], reviewerName: reviewer.name, hasTool: !!reviewer.tool, toolRan, toolError };
  }
}

async function resolveGitHubContext(
  options: PRReviewPipelineOptions,
  repoPath: string
): Promise<{ owner: string; repo: string; prNumber: number } | null> {
  // Try GitHub Actions environment first
  const envCtx = getGitHubEnvContext();
  if (envCtx) return envCtx;

  // Fall back to git remote + manual PR number
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
