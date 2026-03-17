import { Reviewer, OrchestratorResult, ReviewIssue, TokenUsageSummary } from '../../types/index';
import { getStructuredRuntime } from '../runtime/factory';
import { orchestratorResultSchema } from '../validation/schemas';
import { buildOrchestratorSystemPrompt, buildOrchestratorUserMessage } from '../prompts/pr-review';
import { CommitSummary } from '../git/index';
import { formatErrorWithCauses } from '../runtime/error-format';

const BROAD_CODE_REVIEWER_IDS = ['bug-hunter', 'code-quality', 'complexity', 'test-quality', 'clean-code', 'security-api', 'resiliency'];
const OVERLAPPING_CODE_REVIEWER_IDS = new Set(['bug-hunter', 'code-quality', 'complexity', 'clean-code', 'error-handling']);
const WORKFLOW_REVIEWER_IDS = ['ci-cd'];
const DOCS_ONLY_PATTERN = /(^|\/)(docs?|changes?)\/|\.mdx?$/i;
const SOURCE_FILE_PATTERN = /\.(cjs|cts|go|java|js|jsx|mjs|mts|php|py|rb|rs|sh|sql|ts|tsx|ya?ml)$/i;
const TEST_FILE_PATTERN = /(^|\/)(test|tests|spec|specs|__tests__)\/|(\.test\.|\.(spec|e2e)\.)/i;
const WORKFLOW_FILE_PATTERN = /(^|\/)\.github\/workflows\/|(^|\/)(docker-compose|Dockerfile|Makefile|package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/i;
const LOGGING_SIGNAL_PATTERN = /\b(log|logger|logging|console\.)\b/i;
const RESILIENCY_SIGNAL_PATTERN = /\b(retry|backoff|timeout|abort|fetch|http|request|response|circuit|resilien)\b/i;
const MAX_OVERLAPPING_CODE_REVIEWERS = 3;
const MAX_STABLE_PR_REVIEWERS = 6;

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

  if (multiDomain || largerPr) return 5;
  if (codeCoverage || workflowCoverage || changedFiles.length > 0) return 3;
  return 2;
}

function touchesLogging(changedFiles: string[], diff: string): boolean {
  return changedFiles.some(file => LOGGING_SIGNAL_PATTERN.test(file)) || LOGGING_SIGNAL_PATTERN.test(diff);
}

function touchesResiliency(changedFiles: string[], diff: string): boolean {
  return changedFiles.some(file => RESILIENCY_SIGNAL_PATTERN.test(file)) || RESILIENCY_SIGNAL_PATTERN.test(diff);
}

function stabilizeReviewerSelection(
  initial: OrchestratorResult,
  changedFiles: string[],
  diff: string,
): OrchestratorResult {
  const selected: OrchestratorResult['selectedReviewers'] = [];
  let overlappingCodeReviewerCount = 0;
  const allowLoggingReviewer = touchesLogging(changedFiles, diff);
  const allowResiliencyReviewer = touchesResiliency(changedFiles, diff);

  for (const reviewer of initial.selectedReviewers) {
    if (reviewer.reviewerId === 'log-reviewer' && !allowLoggingReviewer) {
      continue;
    }

    if (reviewer.reviewerId === 'resiliency' && !allowResiliencyReviewer) {
      continue;
    }

    if (OVERLAPPING_CODE_REVIEWER_IDS.has(reviewer.reviewerId)) {
      if (overlappingCodeReviewerCount >= MAX_OVERLAPPING_CODE_REVIEWERS) {
        continue;
      }
      overlappingCodeReviewerCount += 1;
    }

    selected.push(reviewer);
  }

  return { selectedReviewers: selected.slice(0, MAX_STABLE_PR_REVIEWERS) };
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
): Promise<ReviewerSelectionResult> {
  const runtime = await getStructuredRuntime();

  const reviewerDescriptions = availableReviewers.map(r => ({
    id: r.id,
    name: r.name,
    description: r.description,
    scopeHints: r.scopeHints,
  }));

  const systemPrompt = buildOrchestratorSystemPrompt(reviewerDescriptions);
  const userMessage = buildOrchestratorUserMessage(changedFiles, diff, commits);

  try {
    const result = await runtime.run<OrchestratorResult>(
      { systemPrompt, userMessage, model, apiKey, transport, apiBaseUrl, maxTokens: 4096, temperature: 0, callLabel: 'orchestrator' },
      orchestratorResultSchema
    );
    return {
      ...stabilizeReviewerSelection(
        broadenReviewerSelection(result.data, availableReviewers, changedFiles, commits),
        changedFiles,
        diff,
      ),
      issues: [],
      tokensUsed: result.tokensUsed,
    };
  } catch (err) {
    // Orchestrator failed — fall back to a SMALL core set using the same
    // broadening logic that normally supplements the AI's selection.
    // NEVER fall back to ALL reviewers: that causes catastrophic cost explosion.
    const fallbackSelection = broadenReviewerSelection(
      { selectedReviewers: [] },
      availableReviewers,
      changedFiles,
      commits,
    );

    return {
      ...stabilizeReviewerSelection(fallbackSelection, changedFiles, diff),
      issues: [
        {
          severity: 'warning',
          code: 'pr-orchestrator-fallback',
          message: `PR reviewer orchestrator failed (${formatErrorWithCauses(err)}); using ${fallbackSelection.selectedReviewers.length} core reviewer(s) as fallback.`,
          stage: 'select-reviewers',
        },
      ],
    };
  }
}
