import { Reviewer, OrchestratorResult, ReviewIssue, TokenUsageSummary } from '../../types/index';
import { getStructuredRuntime } from '../runtime/factory';
import { orchestratorResultSchema } from '../validation/schemas';
import { buildOrchestratorSystemPrompt, buildOrchestratorUserMessage } from '../prompts/pr-review';
import { CommitSummary } from '../git/index';
import { formatErrorWithCauses } from '../runtime/error-format';

/** Absolute hard cap — prevents runaway costs if orchestrator returns unusually many reviewers */
const ABSOLUTE_MAX_PR_REVIEWERS = 10;

/** Fallback reviewer IDs used when the orchestrator itself fails */
const FALLBACK_REVIEWER_IDS = ['bug-hunter', 'code-quality', 'security-api', 'error-handling'];

/**
 * Trim the selection to `limit` reviewers, preferring those with the highest confidence.
 * Reviewers already sorted by confidence desc will be sliced; others are sorted first.
 */
function trimByConfidence(
  selection: OrchestratorResult['selectedReviewers'],
  limit: number,
): OrchestratorResult['selectedReviewers'] {
  if (selection.length <= limit) return selection;
  return [...selection]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
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

  try {
    const result = await runtime.run<OrchestratorResult>(
      { systemPrompt, userMessage, model, apiKey, transport, apiBaseUrl, maxTokens: 4096, temperature: 0, callLabel: 'orchestrator' },
      orchestratorResultSchema
    );

    // Filter to reviewers that actually exist in the available set
    const availableIds = new Set(availableReviewers.map(r => r.id));
    const validSelection = result.data.selectedReviewers.filter(s => availableIds.has(s.reviewerId));

    // Apply configured or hard cap via confidence-based trimming
    const trimmed = trimByConfidence(validSelection, effectiveLimit);

    return {
      selectedReviewers: trimmed,
      issues: [],
      tokensUsed: result.tokensUsed,
    };
  } catch (err) {
    // Orchestrator failed — fall back to a small hardcoded core set to avoid cost explosion.
    const availableIds = new Set(availableReviewers.map(r => r.id));
    const fallbackSelected = FALLBACK_REVIEWER_IDS
      .filter(id => availableIds.has(id))
      .map(id => ({ reviewerId: id, reason: 'Fallback selection after orchestrator failure.', confidence: 0.7 }));

    return {
      selectedReviewers: trimByConfidence(fallbackSelected, effectiveLimit),
      issues: [
        {
          severity: 'warning',
          code: 'pr-orchestrator-fallback',
          message: `PR reviewer orchestrator failed (${formatErrorWithCauses(err)}); using ${fallbackSelected.length} core reviewer(s) as fallback.`,
          stage: 'select-reviewers',
        },
      ],
    };
  }
}
