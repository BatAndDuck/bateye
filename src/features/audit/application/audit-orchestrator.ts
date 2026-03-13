import * as path from 'path';
import * as fs from 'fs';
import { Reviewer, OrchestratorResult } from '../../../types/index';
import { RepoIndex } from '../../../types/index';
import { getRuntime } from '../../../core/runtime/factory';
import { orchestratorResultSchema } from '../../../core/validation/schemas';
import {
  buildAuditOrchestratorSystemPrompt,
  buildAuditOrchestratorUserMessage,
  RepoProfile,
} from '../../../core/prompts/audit';

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

export async function selectAuditReviewers(
  index: RepoIndex,
  availableReviewers: Reviewer[],
  model: string,
  apiKey: string,
  transport?: string,
  apiBaseUrl?: string,
): Promise<OrchestratorResult> {
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
      { systemPrompt, userMessage, model, apiKey, transport, apiBaseUrl, maxTokens: 2048, temperature: 0 },
      orchestratorResultSchema,
    );
    return result.data;
  } catch {
    // Fall back to all reviewers if orchestrator fails
    return {
      selectedReviewers: availableReviewers.map(r => ({
        reviewerId: r.id,
        reason: 'Selected by fallback (orchestrator unavailable)',
      })),
    };
  }
}
