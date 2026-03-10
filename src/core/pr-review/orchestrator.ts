import { Reviewer, OrchestratorResult } from '../../types/index';
import { getRuntime } from '../runtime/factory';
import { orchestratorResultSchema } from '../validation/schemas';
import { buildOrchestratorSystemPrompt, buildOrchestratorUserMessage } from '../prompts/pr-review';

export async function selectReviewers(
  changedFiles: string[],
  diff: string,
  availableReviewers: Reviewer[],
  model: string,
  apiKey: string
): Promise<OrchestratorResult> {
  const runtime = await getRuntime();

  const reviewerDescriptions = availableReviewers.map(r => ({
    id: r.id,
    name: r.name,
    description: r.description,
    scopeHints: r.scopeHints,
  }));

  const systemPrompt = buildOrchestratorSystemPrompt(reviewerDescriptions);
  const userMessage = buildOrchestratorUserMessage(changedFiles, diff);

  try {
    const result = await runtime.run<OrchestratorResult>(
      { systemPrompt, userMessage, model, apiKey, maxTokens: 2048, temperature: 0 },
      orchestratorResultSchema
    );
    return result.data;
  } catch {
    // Fall back to selecting all reviewers if orchestrator fails
    return {
      selectedReviewers: availableReviewers.map(r => ({
        reviewerId: r.id,
        reason: 'Selected by fallback (orchestrator unavailable)',
      })),
    };
  }
}
