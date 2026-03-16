import * as path from 'path';
import { Reviewer, OrchestratorResult } from '../../../types/index';
import { RepoIndex } from '../../../types/index';
import { getRuntime } from '../../../core/runtime/factory';
import { orchestratorResultSchema } from '../../../core/validation/schemas';
import {
  buildAuditOrchestratorSystemPrompt,
  buildAuditOrchestratorUserMessage,
  RepoProfile,
} from '../../../core/prompts/audit';

const ORCHESTRATOR_MAX_TOKENS = 2048;
const ORCHESTRATOR_TEMPERATURE = 0;

/**
 * Maximum number of reviewers to run when the orchestrator is unavailable.
 * Limits blast radius instead of falling back to the full reviewer catalogue.
 */
const FALLBACK_MAX_REVIEWERS = 10;

/** Reviewer IDs that are always included in the fallback set (highest signal/cost ratio). */
const FALLBACK_CORE_IDS = ['security-api', 'code-quality', 'documentation'];

function buildRepoProfile(index: RepoIndex): RepoProfile {
  const extensionCounts: Record<string, number> = {};
  const topDirSet = new Set<string>();

  for (const file of index.files) {
    const ext = path.extname(file.relativePath).toLowerCase() || '(no ext)';
    extensionCounts[ext] = (extensionCounts[ext] ?? 0) + 1;

    // Collect top-level directory names
    const parts = file.relativePath.split('/');
    if (parts.length > 1) {
      topDirSet.add(parts[0]);
    }
  }

  const allPaths = index.files.map(f => f.relativePath.toLowerCase());

  const has = (patterns: RegExp[]) => allPaths.some(p => patterns.some(rx => rx.test(p)));

  return {
    totalFiles: index.totalFiles,
    extensionCounts,
    topDirectories: Array.from(topDirSet).sort().slice(0, 20),
    hasDockerfile: has([/dockerfile/i, /\.dockerignore/i]),
    hasTerraform: has([/\.tf$/, /\.tfvars$/]),
    hasHelmCharts: has([/helm\//i, /chart\.yaml$/i, /values\.yaml$/i]),
    hasGitHubActions: has([/\.github\/workflows\//]),
    hasPackageJson: has([/^package\.json$/, /\/package\.json$/]),
    hasPyProject: has([/pyproject\.toml$/, /requirements.*\.txt$/, /setup\.py$/]),
    hasGoMod: has([/^go\.mod$/]),
    hasSqlFiles: has([/\.sql$/, /migrations?\//i, /migration\.ts$/]),
    hasGraphQL: has([/\.graphql$/, /\.gql$/, /schema\.ts$/]),
    hasTestFiles: has([/\.test\.[jt]sx?$/, /\.spec\.[jt]sx?$/, /tests?\//i, /__tests__\//]),
    hasFrontendFiles: has([/\.tsx$/, /\.jsx$/, /\.vue$/, /\.svelte$/, /\.html$/, /\.css$/, /\.scss$/, /\.less$/]),
    hasAiLibraries: has([/openai/i, /anthropic/i, /langchain/i, /llamaindex/i, /huggingface/i, /transformers/i]),
  };
}

/**
 * Build a conservative fallback reviewer list when the orchestrator is unavailable.
 * Always includes core reviewers; pads up to FALLBACK_MAX_REVIEWERS from the rest.
 */
function buildFallbackReviewers(availableReviewers: Reviewer[]): OrchestratorResult {
  const coreSet = new Set(FALLBACK_CORE_IDS);
  const core = availableReviewers.filter(r => coreSet.has(r.id));
  const rest = availableReviewers.filter(r => !coreSet.has(r.id));
  const selected = [...core, ...rest].slice(0, FALLBACK_MAX_REVIEWERS);

  return {
    selectedReviewers: selected.map(r => ({
      reviewerId: r.id,
      reason: 'Selected by fallback (orchestrator unavailable)',
    })),
  };
}

export interface SelectAuditReviewersOptions {
  index: RepoIndex;
  availableReviewers: Reviewer[];
  model: string;
  /** Lighter model for this simple selection task. Falls back to model if not set. */
  lightModel?: string;
  apiKey: string;
  transport?: string;
  apiBaseUrl?: string;
}

export async function selectAuditReviewers(options: SelectAuditReviewersOptions): Promise<OrchestratorResult> {
  const { index, availableReviewers, apiKey, transport, apiBaseUrl } = options;
  // Use lighter model for this simple reviewer-selection task if configured
  const model = options.lightModel || options.model;
  const runtime = await getRuntime();

  const profile = buildRepoProfile(index);

  const reviewerDescriptions = availableReviewers.map(r => ({
    id: r.id,
    name: r.name,
    description: r.description,
    category: r.category,
    scopeHints: r.scopeHints,
  }));

  const systemPrompt = buildAuditOrchestratorSystemPrompt(reviewerDescriptions);
  const userMessage = buildAuditOrchestratorUserMessage(profile);

  try {
    const result = await runtime.run<OrchestratorResult>(
      { systemPrompt, userMessage, model, apiKey, transport, apiBaseUrl, maxTokens: ORCHESTRATOR_MAX_TOKENS, temperature: ORCHESTRATOR_TEMPERATURE },
      orchestratorResultSchema,
    );
    return result.data;
  } catch {
    // Orchestrator unavailable — use a conservative core set rather than all reviewers
    // to avoid cost explosion (60+ reviewers × full codebase = expensive).
    return buildFallbackReviewers(availableReviewers);
  }
}
