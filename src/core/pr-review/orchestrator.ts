import { Reviewer, OrchestratorResult, ReviewIssue, TokenUsageSummary } from '../../types/index';
import { getPRReviewRuntime } from '../runtime/factory';
import { PRReviewPlannerAnalysis, prReviewPlannerResultSchema } from '../validation/schemas';
import { buildPRPlannerSystemPrompt, buildPRPlannerUserMessage } from '../prompts/pr-review';
import { CommitSummary } from '../git/index';
import { formatErrorWithCauses } from '../runtime/error-format';
import { logPrompt } from '../output/prompt-logger';
import {
  MAX_PR_PLANNER_TIMEOUT_MS,
  PR_PLANNER_MAX_STEPS,
} from '../config/defaults';

/** Absolute hard cap on built-in reviewer count - prevents runaway costs if orchestrator over-selects */
const ABSOLUTE_MAX_PR_REVIEWERS = 20;

/** Maximum number of orchestrator call attempts before propagating the error */
const MAX_ORCHESTRATOR_ATTEMPTS = 3;

/**
 * Trim the built-in reviewer selection to `limit`, preferring those with the highest confidence.
 * Custom reviewers (isBuiltIn=false) always bypass this cap and are included unconditionally.
 */
function trimByConfidence(
  selection: OrchestratorResult['selectedReviewers'],
  availableReviewers: Reviewer[],
  limit: number,
): OrchestratorResult['selectedReviewers'] {
  const isBuiltInMap = new Map(availableReviewers.map(r => [r.id, r.isBuiltIn]));

  const builtIn = selection.filter(s => isBuiltInMap.get(s.reviewerId) === true);

  if (builtIn.length <= limit) {
    return selection;
  }

  const allowedBuiltInIds = new Set(
    [...builtIn]
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit)
      .map(item => item.reviewerId),
  );

  return selection.filter(item => isBuiltInMap.get(item.reviewerId) === false || allowedBuiltInIds.has(item.reviewerId));
}

export interface ReviewerSelectionResult extends OrchestratorResult {
  issues: ReviewIssue[];
  tokensUsed?: TokenUsageSummary;
}

export async function selectReviewers(
  repoPath: string,
  changedFiles: string[],
  diff: string,
  commits: CommitSummary[],
  availableReviewers: Reviewer[],
  model: string,
  apiKey: string,
  maxReviewers?: number,
  transport?: string,
  apiBaseUrl?: string,
  promptLogDir?: string,
  onLog?: (msg: string) => void,
  reasoningEffort?: string,
  reasoningOverrides?: Array<{ model: string; reasoningEffort: string }>,
): Promise<ReviewerSelectionResult> {
  const runtime = await getPRReviewRuntime();

  const reviewerDescriptions = availableReviewers.map(r => ({
    id: r.id,
    name: r.name,
    description: r.description,
    selectWhen: r.selectWhen,
  }));

  const systemPrompt = buildPRPlannerSystemPrompt(reviewerDescriptions);
  const userMessage = buildPRPlannerUserMessage(changedFiles, diff, commits);

  const effectiveLimit = maxReviewers ?? ABSOLUTE_MAX_PR_REVIEWERS;
  const availableIds = new Set(availableReviewers.map(r => r.id));

  if (promptLogDir) {
    logPrompt(promptLogDir, 'pr-planner', systemPrompt, userMessage);
  }

  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ORCHESTRATOR_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      onLog?.(`  - Planner attempt ${attempt}/${MAX_ORCHESTRATOR_ATTEMPTS} (retrying after error)...`);
    } else {
      onLog?.('  - Sending deep planner request to Codebite...');
    }
    try {
      const result = await runtime.runAgenticReview<PRReviewPlannerAnalysis>(
        {
          systemPrompt,
          userMessage,
          model,
          apiKey,
          repoPath,
          initialFiles: changedFiles,
          transport,
          apiBaseUrl,
          maxTokens: 8192,
          temperature: 0,
          timeoutMs: MAX_PR_PLANNER_TIMEOUT_MS,
          maxSteps: PR_PLANNER_MAX_STEPS,
          deepMode: true,
          disableSubagents: false,
          callLabel: 'pr-planner',
          reasoningEffort,
          reasoningOverrides,
        },
        prReviewPlannerResultSchema,
      );

      // Filter to reviewers that actually exist in the available set
      const validSelection = result.data.selectedReviewers.filter(s => availableIds.has(s.reviewerId));

      // Apply configured or hard cap; custom reviewers bypass the built-in cap
      const trimmed = trimByConfidence(validSelection, availableReviewers, effectiveLimit);

      return {
        intentSummary: result.data.intentSummary,
        selectedReviewers: trimmed,
        issues: [],
        tokensUsed: result.tokensUsed,
      };
    } catch (err) {
      lastError = err;
      onLog?.(`  - Planner attempt ${attempt}/${MAX_ORCHESTRATOR_ATTEMPTS} failed: ${(err as Error).message?.slice(0, 120)}`);
      if (attempt < MAX_ORCHESTRATOR_ATTEMPTS) {
        await new Promise(resolve => setTimeout(resolve, 500 * attempt));
      }
    }
  }

  // No fallback to a hardcoded reviewer list - intentional design decision.
  // A silent fallback would mask orchestrator failures and produce reviews with
  // incomplete coverage without surfacing the underlying problem to the user.
  // Callers should let this propagate so CI pipelines catch the failure visibly.
  throw new Error(
    `PR review planner failed after ${MAX_ORCHESTRATOR_ATTEMPTS} attempts: ${formatErrorWithCauses(lastError)}`,
  );
}
