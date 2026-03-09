import * as path from 'path';
import { Finding, PRReviewResult, Config, Reviewer } from '../../types/index';
import { resolveConfig, resolveApiKey } from '../config/loader';
import { loadReviewers } from '../reviewers/loader';
import { getRuntime } from '../runtime/factory';
import { reviewerAnalysisSchema, ReviewerAnalysis } from '../validation/schemas';
import { buildPRReviewSystemPrompt, buildPRReviewUserMessage, buildPRSummaryPrompt } from '../prompts/pr-review';
import { getGitDiff, getChangedFiles, getRepoOwnerAndName } from '../git/index';
import { selectReviewers } from './orchestrator';
import { writePRReviewResult, ensureDir } from '../output/writer';
import { PR_REVIEW_OUTPUT_FILE, OUTPUT_DIR } from '../config/defaults';
import { GitHubReviewPlatform, getGitHubEnvContext } from '../github/platform';

export interface PRReviewOptions {
  repoPath: string;
  baseRef?: string;
  headRef?: string;
  github?: boolean;         // post to GitHub
  githubToken?: string;
  prNumber?: number;
  dryRun?: boolean;
  onProgress?: (msg: string) => void;
}

export async function runPRReview(options: PRReviewOptions): Promise<PRReviewResult> {
  const { repoPath, onProgress } = options;
  const log = (msg: string) => onProgress?.(msg);

  // Load config
  log('Loading configuration...');
  const config = resolveConfig(repoPath);
  const apiKey = resolveApiKey(config);

  const baseRef = options.baseRef || 'origin/main';
  const headRef = options.headRef || 'HEAD';

  // Get diff
  log(`Getting diff: ${baseRef}...${headRef}`);
  const diff = await getGitDiff(repoPath, baseRef, headRef);
  const changedFiles = await getChangedFiles(repoPath, baseRef, headRef);
  log(`Changed files: ${changedFiles.length}`);

  if (changedFiles.length === 0) {
    throw new Error('No changed files found between the specified refs.');
  }

  // Load reviewers
  log('Loading reviewers...');
  const { reviewers } = loadReviewers(repoPath);

  // Use orchestrator to select relevant reviewers
  log('Selecting relevant reviewers...');
  const orchestratorResult = await selectReviewers(
    changedFiles,
    diff,
    reviewers,
    config.lightModel,
    apiKey
  );

  const selectedReviewerIds = new Set(orchestratorResult.selectedReviewers.map(r => r.reviewerId));
  const selectedReviewers = reviewers.filter(r => selectedReviewerIds.has(r.id));

  log(`Selected ${selectedReviewers.length} reviewer(s): ${selectedReviewers.map(r => r.name).join(', ')}`);

  // Run each reviewer
  const runtime = await getRuntime();
  const allFindings: Finding[] = [];

  for (const reviewer of selectedReviewers) {
    log(`Running reviewer: ${reviewer.name}...`);
    const findings = await runPRReviewer(reviewer, diff, changedFiles, config.model, apiKey, runtime);
    allFindings.push(...findings);
    log(`  ✓ ${reviewer.name}: ${findings.length} findings`);
  }

  const result: PRReviewResult = {
    command: 'pr-review',
    baseRef,
    headRef,
    selectedReviewers: orchestratorResult.selectedReviewers,
    summary: buildPRSummaryPrompt(allFindings),
    findings: allFindings,
    generatedAt: new Date().toISOString(),
  };

  // Write local artifact
  const outputPath = path.join(repoPath, PR_REVIEW_OUTPUT_FILE);
  ensureDir(path.join(repoPath, OUTPUT_DIR));
  writePRReviewResult(outputPath, result);

  // Post to GitHub if requested
  if (options.github && !options.dryRun) {
    await postToGitHub(result, options, repoPath, log);
  }

  return result;
}

async function runPRReviewer(
  reviewer: Reviewer,
  diff: string,
  changedFiles: string[],
  model: string,
  apiKey: string,
  runtime: import('../runtime/interface').IRuntime
): Promise<Finding[]> {
  const systemPrompt = buildPRReviewSystemPrompt(reviewer.instructions, reviewer.id, reviewer.name);
  const userMessage = buildPRReviewUserMessage(diff, changedFiles);

  try {
    const runResult = await runtime.run<ReviewerAnalysis>(
      { systemPrompt, userMessage, model: reviewer.model || model, apiKey, maxTokens: 8096 },
      reviewerAnalysisSchema
    );
    return runResult.data.findings.map(f => ({
      ...f,
      reviewerId: reviewer.id,
      reviewerName: reviewer.name,
    }));
  } catch (err) {
    console.warn(`Reviewer ${reviewer.id} failed: ${(err as Error).message}`);
    return [];
  }
}

async function postToGitHub(
  result: PRReviewResult,
  options: PRReviewOptions,
  repoPath: string,
  log: (msg: string) => void
): Promise<void> {
  const token = options.githubToken || process.env.GITHUB_TOKEN;
  if (!token) {
    log('Warning: GITHUB_TOKEN not set. Skipping GitHub comments.');
    return;
  }

  let owner: string, repo: string, prNumber: number;

  // Try to get from GitHub Actions env first
  const envCtx = getGitHubEnvContext();
  if (envCtx) {
    ({ owner, repo, prNumber } = envCtx);
  } else {
    const repoInfo = await getRepoOwnerAndName(repoPath);
    if (!repoInfo) {
      log('Warning: Cannot determine GitHub repo. Use --owner and --repo flags.');
      return;
    }
    ({ owner, repo } = repoInfo);
    prNumber = options.prNumber!;
    if (!prNumber) {
      log('Warning: --pr-number is required for GitHub comments outside of GitHub Actions.');
      return;
    }
  }

  const platform = new GitHubReviewPlatform({ token, owner, repo, prNumber, repoPath });

  log(`Posting ${result.findings.length} inline comments to GitHub PR #${prNumber}...`);

  for (const finding of result.findings) {
    await platform.publishInlineComment({
      body: formatFindingComment(finding),
      path: finding.filePath,
      line: finding.startLine,
    });
  }

  log('Posting summary comment...');
  await platform.publishSummaryComment(result.summary);
  log(`✓ GitHub comments posted to ${owner}/${repo}#${prNumber}`);
}

function formatFindingComment(finding: Finding): string {
  const icon = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢', info: 'ℹ️' }[finding.priority] || '•';
  return `${icon} **[CodeOwl ${finding.priority.toUpperCase()}] ${finding.title}**

${finding.description}

**Recommendation:** ${finding.recommendation}

${finding.evidence.length > 0 ? `> ${finding.evidence[0]}` : ''}

*Reviewer: ${finding.reviewerName} | Confidence: ${Math.round(finding.confidence * 100)}%*`;
}

