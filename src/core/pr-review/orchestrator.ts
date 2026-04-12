import { Reviewer, OrchestratorResult, ReviewIssue, TokenUsageSummary } from '../../types/index';
import { getStructuredRuntime } from '../runtime/factory';
import { orchestratorResultSchema } from '../validation/schemas';
import { buildOrchestratorSystemPrompt, buildOrchestratorUserMessage } from '../prompts/pr-review';
import { CommitSummary } from '../git/index';
import { formatErrorWithCauses } from '../runtime/error-format';
import { logPrompt } from '../output/prompt-logger';

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

  const custom = selection.filter(s => isBuiltInMap.get(s.reviewerId) === false);
  const builtIn = selection.filter(s => isBuiltInMap.get(s.reviewerId) === true);

  const cappedBuiltIn = builtIn.length <= limit
    ? builtIn
    : [...builtIn].sort((a, b) => b.confidence - a.confidence).slice(0, limit);

  return [...custom, ...cappedBuiltIn];
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
  maxReviewers?: number,
  transport?: string,
  apiBaseUrl?: string,
  promptLogDir?: string,
  onLog?: (msg: string) => void,
  reasoningEffort?: string,
  reasoningOverrides?: Array<{ model: string; reasoningEffort: string }>,
): Promise<ReviewerSelectionResult> {
  const runtime = await getStructuredRuntime();

  const reviewerDescriptions = availableReviewers.map(r => ({
    id: r.id,
    name: r.name,
    description: r.description,
    selectWhen: r.selectWhen,
  }));

  const systemPrompt = buildOrchestratorSystemPrompt(reviewerDescriptions);
  const userMessage = buildOrchestratorUserMessage(changedFiles, diff, commits);

  const effectiveLimit = maxReviewers ?? ABSOLUTE_MAX_PR_REVIEWERS;
  const availableIds = new Set(availableReviewers.map(r => r.id));

  if (promptLogDir) {
    logPrompt(promptLogDir, 'orchestrator', systemPrompt, userMessage);
  }

  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ORCHESTRATOR_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      onLog?.(`  - Orchestrator attempt ${attempt}/${MAX_ORCHESTRATOR_ATTEMPTS} (retrying after error)...`);
    } else {
      onLog?.(`  - Sending orchestrator request to model...`);
    }
    try {
      const result = await runtime.run<OrchestratorResult>(
        {
          systemPrompt,
          userMessage,
          model,
          apiKey,
          transport,
          apiBaseUrl,
          maxTokens: 4096,
          temperature: 0,
          callLabel: 'orchestrator',
          reasoningEffort,
          reasoningOverrides,
        },
        orchestratorResultSchema,
      );

      // Filter to reviewers that actually exist in the available set
      const validSelection = result.data.selectedReviewers.filter(s => availableIds.has(s.reviewerId));

      // Apply configured or hard cap; custom reviewers bypass the built-in cap
      const trimmed = trimByConfidence(validSelection, availableReviewers, effectiveLimit);

      // Filter the orchestrator's execution plan to the reviewer IDs that actually exist
      // and survived the confidence trim. The deterministic bundle planner downstream
      // will further split groups that violate safety rules (model overrides, tool
      // reviewers, category mismatches).
      const trimmedIds = new Set(trimmed.map(s => s.reviewerId));
      const rawPlan = result.data.executionPlan;
      const filteredPlan = rawPlan
        ?.map(group => ({
          ...group,
          reviewerIds: group.reviewerIds.filter(id => trimmedIds.has(id)),
        }))
        .filter(group => group.reviewerIds.length > 0);

      return {
        intentSummary: result.data.intentSummary,
        selectedReviewers: trimmed,
        executionPlan: filteredPlan && filteredPlan.length > 0 ? filteredPlan : undefined,
        issues: [],
        tokensUsed: result.tokensUsed,
      };
    } catch (err) {
      lastError = err;
      onLog?.(`  - Orchestrator attempt ${attempt}/${MAX_ORCHESTRATOR_ATTEMPTS} failed: ${(err as Error).message?.slice(0, 120)}`);
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
    `PR reviewer orchestrator failed after ${MAX_ORCHESTRATOR_ATTEMPTS} attempts: ${formatErrorWithCauses(lastError)}`,
  );
}
