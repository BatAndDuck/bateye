import * as fs from 'fs';
import * as path from 'path';
import { PRFinding, PRReviewResult, Reviewer } from '../../types/index';
import { resolveConfig, resolveApiKey } from '../config/loader';
import { loadReviewersForMode } from '../reviewers/loader';
import { getPRReviewRuntime } from '../runtime/factory';
import { prReviewerAnalysisSchema, PRReviewerAnalysis } from '../validation/schemas';
import {
  buildPRReviewSystemPrompt,
  buildPRReviewUserMessage,
  buildPRSummaryPrompt,
} from '../prompts/pr-review';
import { getGitDiff, getChangedFiles, getRepoOwnerAndName } from '../git/index';
import { selectReviewers } from './orchestrator';
import { writePRReviewResult, ensureDir } from '../output/writer';
import {
  MAX_PR_CURRENT_CONTEXT_CHARS,
  MAX_PR_CURRENT_FILE_CHARS,
  MAX_PR_REVIEWER_TIMEOUT_MS,
  OUTPUT_DIR,
  PR_REVIEW_OUTPUT_FILE,
} from '../config/defaults';
import { GitHubReviewPlatform, getGitHubEnvContext } from '../github/platform';
import { parseUnifiedDiff, buildReviewerDiffContext, getFilesInDiff } from './diff-parser';
import { verifyFindings } from './verifier';
import { verifyFindingsSemantically } from './semantic-verifier';
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

  log('Loading configuration...');
  const config = resolveConfig(repoPath);
  const apiKey = resolveApiKey(config);
  const baseRef = options.baseRef || 'origin/main';
  const headRef = options.headRef || 'HEAD';

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
  const currentDiffFiles = getFilesInDiff(parsedDiff);
  const currentFileContext = buildCurrentFileContext(repoPath, currentDiffFiles);
  log(`Parsed ${currentDiffFiles.length} files from diff`);

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
    reviewers,
    config.model,
    apiKey,
    config.transport,
    config.apiBaseUrl,
  );

  const selectedReviewerIds = new Set(orchestratorResult.selectedReviewers.map(r => r.reviewerId));
  const selectedReviewers = reviewers.filter(r => selectedReviewerIds.has(r.id));
  log(`Selected ${selectedReviewers.length} reviewer(s): ${selectedReviewers.map(r => r.name).join(', ')}`);

  const runtime = await getPRReviewRuntime();
  log('Running agentic reviewers in parallel...');

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

  log('Running semantic verification...');
  const semantic = await verifyFindingsSemantically(deduped, {
    repoPath,
    runtime,
    model: config.model,
    apiKey,
    transport: config.transport,
    apiBaseUrl: config.apiBaseUrl,
    log,
  });
  log(`Semantic verification: accepted ${semantic.verified.length}, rejected ${semantic.rejected.length}`);

  if (semantic.rejected.length > 0) {
    for (const rejected of semantic.rejected.slice(0, 5)) {
      log(`  ✗ Rejected (semantic): "${rejected.finding.title}" — ${rejected.reason}`);
    }
    if (semantic.rejected.length > 5) {
      log(`  ... and ${semantic.rejected.length - 5} more semantic rejections`);
    }
  }

  let finalFindings = semantic.verified;
  if (conversation) {
    log('Filtering already-posted findings...');
    finalFindings = filterAlreadyPosted(semantic.verified, conversation);
    log(`After filter: ${finalFindings.length} new findings to post`);
  }

  const verificationStats = {
    rawFindings: allFindings.length,
    deterministicRejected: deterministic.rejected.length,
    semanticRejected: semantic.rejected.length,
    finalFindings: finalFindings.length,
  };

  const result: PRReviewResult = {
    command: 'pr-review',
    baseRef,
    headRef,
    selectedReviewers: orchestratorResult.selectedReviewers,
    summary: '',
    findings: finalFindings,
    rejectedFindings: verificationStats.deterministicRejected + verificationStats.semanticRejected,
    verificationStats,
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
    }

    result.verificationStats = {
      ...verificationStats,
      finalFindings: postedFindings.length,
    };
    result.summary = buildPRSummaryPrompt(postedFindings, result.verificationStats, toolSummaries);
    result.findings = postedFindings;

    log('Updating summary comment...');
    await platform.updateOrCreateSummary(result.summary);

    const statusBody = `<!-- codeowl-status -->\n🦉 **CodeOwl** review complete — ${postedFindings.length} findings posted.`;
    await platform.updateStatusComment(statusBody);

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
          const failMsg = '⚠️  Auto-approve failed — enable **Settings → Actions → General → "Allow GitHub Actions to create and approve pull requests"** in this repository.';
          log(failMsg);
          await platform.updateStatusComment(
            `<!-- codeowl-status -->\n🦉 **CodeOwl** review complete — ${postedFindings.length} findings posted.\n\n${failMsg}`
          );
        }
      } else {
        log(`Auto-approve skipped — findings exceed "${maxSev}" threshold.`);
      }
    }

    log('✓ GitHub comments posted');
  } else {
    result.summary = buildPRSummaryPrompt(finalFindings, verificationStats, toolSummaries);
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
      return { findings: [], reviewerName: reviewer.name, hasTool: true, toolRan: false, toolError: toolResult.error };
    } else {
      toolError = toolResult.error;
      toolRan = false;
      log(`  ⚠ Tool for ${reviewer.name} failed (continuing investigation): ${toolResult.error}`);
    }
  }

  const systemPrompt = buildPRReviewSystemPrompt(reviewer.instructions, reviewer.id, reviewer.name);
  const userMessage = buildPRReviewUserMessage(structuredDiff, currentDiffFiles, currentFileContext, toolContext);

  try {
    log(`  Running reviewer: ${reviewer.name}...`);
    const runResult = await runtime.runAgenticPRReview<PRReviewerAnalysis>(
      {
        systemPrompt,
        userMessage,
        model: reviewer.model || model,
        apiKey,
        repoPath,
        changedFiles: currentDiffFiles,
        transport,
        apiBaseUrl,
        maxTokens: 8096,
        temperature: 0,
        timeoutMs: MAX_PR_REVIEWER_TIMEOUT_MS,
      },
      prReviewerAnalysisSchema,
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
