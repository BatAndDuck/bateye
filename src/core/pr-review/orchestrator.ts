import { Reviewer, OrchestratorResult, ReviewIssue, TokenUsageSummary } from '../../types/index';
import { getRuntime } from '../runtime/factory';
import { orchestratorResultSchema } from '../validation/schemas';
import { buildOrchestratorSystemPrompt, buildOrchestratorUserMessage } from '../prompts/pr-review';
import { CommitSummary } from '../git/index';

const BROAD_CODE_REVIEWER_IDS = ['bug-hunter', 'code-quality', 'complexity', 'test-quality', 'clean-code', 'security-api', 'resiliency'];
const WORKFLOW_REVIEWER_IDS = ['ci-cd'];
const DOCS_ONLY_PATTERN = /(^|\/)(docs?|changes?)\/|\.mdx?$/i;
const SOURCE_FILE_PATTERN = /\.(cjs|cts|go|java|js|jsx|mjs|mts|php|py|rb|rs|sh|sql|ts|tsx|ya?ml)$/i;
const TEST_FILE_PATTERN = /(^|\/)(test|tests|spec|specs|__tests__)\/|(\.test\.|\.(spec|e2e)\.)/i;
const WORKFLOW_FILE_PATTERN = /(^|\/)\.github\/workflows\/|(^|\/)(docker-compose|Dockerfile|Makefile|package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/i;

function isDocsOnlyChange(changedFiles: string[]): boolean {
  return changedFiles.length > 0 && changedFiles.every(file => DOCS_ONLY_PATTERN.test(file));
}

function needsWorkflowCoverage(changedFiles: string[]): boolean {
  return changedFiles.some(file => WORKFLOW_FILE_PATTERN.test(file));
}

function needsCodeCoverage(changedFiles: string[]): boolean {
  return changedFiles.some(file => SOURCE_FILE_PATTERN.test(file) && !DOCS_ONLY_PATTERN.test(file));
}

function minimumReviewerCount(changedFiles: string[], commits: CommitSummary[]): number {
  if (isDocsOnlyChange(changedFiles)) return 2;

  const workflowCoverage = needsWorkflowCoverage(changedFiles);
  const codeCoverage = needsCodeCoverage(changedFiles);
  const testCoverage = changedFiles.some(file => TEST_FILE_PATTERN.test(file));
  const multiDomain = [workflowCoverage, codeCoverage, testCoverage].filter(Boolean).length >= 2;
  const largerPr = changedFiles.length >= 8 || commits.length >= 4;

  if (multiDomain || largerPr) return 6;
  if (codeCoverage || workflowCoverage || changedFiles.length > 0) return 4;
  return 2;
}

function broadenReviewerSelection(
  initial: OrchestratorResult,
  availableReviewers: Reviewer[],
  changedFiles: string[],
  commits: CommitSummary[],
): OrchestratorResult {
  if (availableReviewers.some(reviewer => !reviewer.isBuiltIn)) {
    return initial;
  }

  const selected = [...initial.selectedReviewers];
  const selectedIds = new Set(selected.map(reviewer => reviewer.reviewerId));
  const minimum = minimumReviewerCount(changedFiles, commits);

  const preferredIds = [
    ...BROAD_CODE_REVIEWER_IDS,
    ...(needsWorkflowCoverage(changedFiles) ? WORKFLOW_REVIEWER_IDS : []),
  ];

  for (const reviewerId of preferredIds) {
    if (selectedIds.has(reviewerId)) continue;

    const reviewer = availableReviewers.find(candidate => candidate.id === reviewerId);
    if (!reviewer) continue;

    selected.push({
      reviewerId,
      reason: 'Added automatically to broaden baseline PR coverage for this change set.',
    });
    selectedIds.add(reviewerId);

    if (selected.length >= minimum) {
      break;
    }
  }

  return { selectedReviewers: selected };
}

export interface ReviewerSelectionResult extends OrchestratorResult {
  issues: ReviewIssue[];
  tokensUsed?: TokenUsageSummary;
}

export async function selectReviewers(
  changedFiles: string[],
  diff: string,
  commits: CommitSummary[],
  availableReviewers: Reviewer[],
  model: string,
  apiKey: string,
  transport?: string,
  apiBaseUrl?: string,
  lightModel?: string,
): Promise<ReviewerSelectionResult> {
  const runtime = await getRuntime();

  const reviewerDescriptions = availableReviewers.map(r => ({
    id: r.id,
    name: r.name,
    description: r.description,
    scopeHints: r.scopeHints,
  }));

  const systemPrompt = buildOrchestratorSystemPrompt(reviewerDescriptions);
  const userMessage = buildOrchestratorUserMessage(changedFiles, diff, commits);
  // Orchestrator is a simple JSON selection task — use the lighter model if configured
  const orchestratorModel = lightModel || model;

  try {
    const result = await runtime.run<OrchestratorResult>(
      { systemPrompt, userMessage, model: orchestratorModel, apiKey, transport, apiBaseUrl, maxTokens: 2048, temperature: 0 },
      orchestratorResultSchema
    );
    return {
      ...broadenReviewerSelection(result.data, availableReviewers, changedFiles, commits),
      issues: [],
      tokensUsed: result.tokensUsed,
    };
  } catch {
    // Fall back to selecting all reviewers if orchestrator fails
    return {
      selectedReviewers: availableReviewers.map(r => ({
        reviewerId: r.id,
        reason: 'Selected by fallback (orchestrator unavailable)',
      })),
      issues: [
        {
          severity: 'warning',
          code: 'pr-orchestrator-fallback',
          message: 'PR reviewer orchestrator failed and all available reviewers were selected instead.',
          stage: 'select-reviewers',
        },
      ],
    };
  }
}
