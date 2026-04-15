import {
  MAX_PR_DEDUP_BATCH_SIZE,
  MAX_PR_DEDUP_CANDIDATE_PAIRS,
  MAX_PR_DEDUP_TIMEOUT_MS,
  MAX_PR_DEDUP_TOKENS,
} from '../config/defaults';
import { logPrompt } from '../output/prompt-logger';
import { buildPRDedupArbiterSystemPrompt, buildPRDedupArbiterUserMessage } from '../prompts/pr-review';
import { formatErrorWithCauses } from '../runtime/error-format';
import { IRuntime, TokenUsage } from '../runtime/interface';
import { addTokens } from '../runtime/token-utils';
import {
  prFindingDedupDecisionBatchSchema,
} from '../validation/schemas';
import {
  PRFindingDuplicateCandidate,
  PRFindingDuplicateDecision,
} from './deduplicator';
import type { PRFindingDedupDecisionBatch } from '../validation/schemas';

type RunPRDedupArbiterOptions = {
  candidates: PRFindingDuplicateCandidate[];
  runtime: IRuntime;
  model: string;
  apiKey: string;
  transport?: string;
  apiBaseUrl?: string;
  promptLogDir?: string;
  onLog?: (msg: string) => void;
};

function chunkCandidates(candidates: PRFindingDuplicateCandidate[]): PRFindingDuplicateCandidate[][] {
  const limited = candidates.slice(0, MAX_PR_DEDUP_CANDIDATE_PAIRS);
  const chunks: PRFindingDuplicateCandidate[][] = [];

  for (let i = 0; i < limited.length; i += MAX_PR_DEDUP_BATCH_SIZE) {
    chunks.push(limited.slice(i, i + MAX_PR_DEDUP_BATCH_SIZE));
  }

  return chunks;
}

export async function runPRDedupArbiter(options: RunPRDedupArbiterOptions): Promise<{
  decisions: PRFindingDuplicateDecision[];
  tokensUsed?: TokenUsage;
  skippedCandidates: number;
}> {
  const { candidates, runtime } = options;
  if (candidates.length === 0) {
    return { decisions: [], skippedCandidates: 0 };
  }

  const batches = chunkCandidates(candidates);
  const systemPrompt = buildPRDedupArbiterSystemPrompt();
  const decisions: PRFindingDuplicateDecision[] = [];
  const skippedCandidates = Math.max(candidates.length - MAX_PR_DEDUP_CANDIDATE_PAIRS, 0);
  let tokensUsed: TokenUsage | undefined;

  if (skippedCandidates > 0) {
    options.onLog?.(
      `Dedup arbiter: considering top ${MAX_PR_DEDUP_CANDIDATE_PAIRS}/${candidates.length} ambiguous pair(s); leaving ${skippedCandidates} low-signal pair(s) distinct.`,
    );
  }

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    const userMessage = buildPRDedupArbiterUserMessage(batch);
    const callLabel = `pr-dedup-arbiter-${batchIndex + 1}`;

    if (options.promptLogDir) {
      logPrompt(options.promptLogDir, callLabel, systemPrompt, userMessage);
    }

    const result = await runtime.run<PRFindingDedupDecisionBatch>(
      {
        systemPrompt,
        userMessage,
        model: options.model,
        apiKey: options.apiKey,
        transport: options.transport,
        apiBaseUrl: options.apiBaseUrl,
        maxTokens: MAX_PR_DEDUP_TOKENS,
        maxInputChars: 18_000,
        temperature: 0,
        timeoutMs: MAX_PR_DEDUP_TIMEOUT_MS,
        callLabel,
      },
      prFindingDedupDecisionBatchSchema,
    );

    if (result.tokensUsed) {
      tokensUsed = tokensUsed ? addTokens(tokensUsed, result.tokensUsed) : result.tokensUsed;
    }

    const decisionMap = new Map(result.data.decisions.map(decision => [`${decision.aId}::${decision.bId}`, decision]));
    for (const candidate of batch) {
      const key = `${candidate.a.id}::${candidate.b.id}`;
      const reverseKey = `${candidate.b.id}::${candidate.a.id}`;
      const response = decisionMap.get(key) || decisionMap.get(reverseKey);
      if (!response) {
        decisions.push({
          aId: candidate.a.id,
          bId: candidate.b.id,
          verdict: 'unsure',
          confidence: 0,
          rationale: 'The dedup arbiter did not return a decision for this pair.',
          source: 'llm',
        });
        continue;
      }

      decisions.push({
        aId: response.aId,
        bId: response.bId,
        verdict: response.verdict,
        confidence: response.confidence,
        rationale: response.rationale,
        source: 'llm',
      });
    }
  }

  return {
    decisions,
    tokensUsed,
    skippedCandidates,
  };
}

export function formatDedupArbiterError(err: unknown): string {
  return `PR dedup arbiter failed: ${formatErrorWithCauses(err)}`;
}
