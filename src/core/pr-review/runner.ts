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

  // Optional fallback model + key — used when primary is rate-limited
  const fallbackModel = config.fallbackModel;
  const fallbackApiKey = fallbackModel ? process.env['CODE_OWL_LLM_MODEL_API_KEY_FALLBACK'] : undefined;
  if (fallbackModel && !fallbackApiKey) {
    console.warn(`Warning: fallbackModel "${fallbackModel}" is configured but CODE_OWL_LLM_MODEL_API_KEY_FALLBACK is not set — fallback will not be used.`);
  }

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
    config.model,
    apiKey
  );

  const selectedReviewerIds = new Set(orchestratorResult.selectedReviewers.map(r => r.reviewerId));
  const selectedReviewers = reviewers.filter(r => selectedReviewerIds.has(r.id));

  log(`Selected ${selectedReviewers.length} reviewer(s): ${selectedReviewers.map(r => r.name).join(', ')}`);

  // Run each reviewer
  const runtime = await getRuntime();
  const allFindings: Finding[] = [];
  const reviewerErrors: { id: string; name: string; message: string }[] = [];

  for (const reviewer of selectedReviewers) {
    log(`Running reviewer: ${reviewer.name}...`);
    try {
      const findings = await runPRReviewer(reviewer, diff, changedFiles, reviewer.model || config.model, apiKey, runtime);
      allFindings.push(...findings);
      log(`  ✓ ${reviewer.name}: ${findings.length} findings`);
    } catch (primaryErr) {
      // If primary was rate-limited and a fallback model is configured, try that instead
      if (is429Error(primaryErr) && fallbackModel && fallbackApiKey) {
        log(`  ⚠ ${reviewer.name} rate-limited on primary model, retrying with fallback model...`);
        try {
          const findings = await runPRReviewer(reviewer, diff, changedFiles, fallbackModel, fallbackApiKey, runtime);
          allFindings.push(...findings);
          log(`  ✓ ${reviewer.name} (via fallback): ${findings.length} findings`);
          continue;
        } catch (fallbackErr) {
          const message = (fallbackErr as Error).message;
          console.warn(`Reviewer ${reviewer.id} also failed on fallback model: ${message}`);
          reviewerErrors.push({ id: reviewer.id, name: reviewer.name, message: `primary 429, fallback: ${message}` });
          continue;
        }
      }
      const message = (primaryErr as Error).message;
      console.warn(`Reviewer ${reviewer.id} failed: ${message}`);
      reviewerErrors.push({ id: reviewer.id, name: reviewer.name, message });
    }
  }

  if (reviewerErrors.length === selectedReviewers.length) {
    throw new Error(
      `All reviewers failed. Errors:\n${reviewerErrors.map(e => `  - ${e.name}: ${e.message}`).join('\n')}`
    );
  }

  const result: PRReviewResult = {
    command: 'pr-review',
    baseRef,
    headRef,
    selectedReviewers: orchestratorResult.selectedReviewers,
    summary: buildPRSummaryPrompt(allFindings, reviewerErrors),
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

function is429Error(err: unknown): boolean {
  const msg = (err as Error).message || '';
  return msg.includes('429') || msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('too many requests');
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
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

  const maxRetries = 3;
  const backoffMs = [10000, 30000, 60000];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
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
      const isRateLimit = is429Error(err);
      if (isRateLimit && attempt < maxRetries) {
        const waitMs = backoffMs[attempt];
        console.warn(`Reviewer ${reviewer.id} rate-limited (429), retrying in ${waitMs / 1000}s... (attempt ${attempt + 1}/${maxRetries})`);
        await sleep(waitMs);
        continue;
      }
      // Throw so the caller can track which reviewers failed
      throw err;
    }
  }
  // Unreachable, but TypeScript needs it
  return [];
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

  log(`Posting ${result.findings.length} findings to GitHub PR #${prNumber}...`);

  for (const finding of result.findings) {
    const postedInline = await platform.publishInlineComment({
      body: formatFindingComment(finding),
      path: finding.filePath,
      line: finding.startLine,
    });

    if (!postedInline) {
      // Line not in diff — post as a standalone PR comment so the finding isn't lost
      log(`  Falling back to standalone comment for ${finding.filePath}:${finding.startLine}`);
      await platform.publishSummaryComment(formatFindingComment(finding));
    }
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

