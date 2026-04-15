import * as fs from 'fs';
import { z } from 'zod';
import { AgenticRepositoryReviewOptions, IRuntime, RunOptions, RunResult } from '../../../core/runtime/interface';

type MockRuntimeFixtures = {
  runs: Array<{
    data: unknown;
    model?: string;
    runtime?: 'sdk' | 'cli';
    rawResponse?: string;
    tokensUsed?: {
      inputTokens: number;
      outputTokens: number;
      estimated?: boolean;
    };
  }>;
  agenticRuns?: Array<{
    data: unknown;
    model?: string;
    runtime?: 'sdk' | 'cli';
    rawResponse?: string;
    tokensUsed?: {
      inputTokens: number;
      outputTokens: number;
      estimated?: boolean;
    };
  }>;
  models?: Record<string, string[]>;
};

function readFixtures(): MockRuntimeFixtures {
  const fixturePath = process.env.BATEYE_MOCK_RUNTIME_FIXTURES;
  if (!fixturePath) {
    throw new Error('BATEYE_MOCK_RUNTIME_FIXTURES is required when BATEYE_RUNTIME=mock');
  }

  return JSON.parse(fs.readFileSync(fixturePath, 'utf-8')) as MockRuntimeFixtures;
}

function writeFixtures(fixtures: MockRuntimeFixtures): void {
  const fixturePath = process.env.BATEYE_MOCK_RUNTIME_FIXTURES;
  if (!fixturePath) {
    throw new Error('BATEYE_MOCK_RUNTIME_FIXTURES is required when BATEYE_RUNTIME=mock');
  }

  fs.writeFileSync(fixturePath, JSON.stringify(fixtures, null, 2) + '\n', 'utf-8');
}

function appendLog(entry: unknown): void {
  const logPath = process.env.BATEYE_MOCK_RUNTIME_LOG;
  if (!logPath) {
    return;
  }

  const current = fs.existsSync(logPath)
    ? JSON.parse(fs.readFileSync(logPath, 'utf-8')) as unknown[]
    : [];
  current.push(entry);
  fs.writeFileSync(logPath, JSON.stringify(current, null, 2) + '\n', 'utf-8');
}

function normalizePlannerFixtureData(data: unknown): unknown {
  if (!data || typeof data !== 'object') {
    return data;
  }

  const payload = data as {
    selectedReviewers?: Array<Record<string, unknown>>;
  };

  if (!Array.isArray(payload.selectedReviewers)) {
    return data;
  }

  return {
    ...payload,
    selectedReviewers: payload.selectedReviewers.map((selection) => ({
      ...selection,
      briefing: typeof selection.briefing === 'string'
        ? selection.briefing
        : `Start from the changed files that match reviewer "${String(selection.reviewerId || 'unknown')}" and investigate the relevant flow directly.`,
      contextPaths: Array.isArray(selection.contextPaths) ? selection.contextPaths : [],
      verticalFlows: Array.isArray(selection.verticalFlows) ? selection.verticalFlows : [],
      businessContext: Array.isArray(selection.businessContext) ? selection.businessContext : [],
      consistencyReferences: Array.isArray(selection.consistencyReferences) ? selection.consistencyReferences : [],
      testLocations: Array.isArray(selection.testLocations) ? selection.testLocations : [],
      issueHints: Array.isArray(selection.issueHints) ? selection.issueHints : [],
    })),
  };
}

export class MockRuntime implements IRuntime {
  async run<T>(options: RunOptions, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<RunResult<T>> {
    const fixtures = readFixtures();
    const next = fixtures.runs.shift();
    if (!next) {
      throw new Error('No mock runtime response remaining for run()');
    }

    writeFixtures(fixtures);
    appendLog({
      type: 'run',
      model: options.model,
      reasoningEffort: options.reasoningEffort,
      reasoningOverrides: options.reasoningOverrides,
      callLabel: options.callLabel,
      promptPreview: options.systemPrompt.slice(0, 80),
    });

    return {
      data: schema.parse(next.data),
      model: next.model || options.model,
      runtime: next.runtime || 'sdk',
      durationMs: 0,
      rawResponse: next.rawResponse || JSON.stringify(next.data),
      tokensUsed: next.tokensUsed,
    };
  }

  async runAgenticReview<T>(options: AgenticRepositoryReviewOptions, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<RunResult<T>> {
    const fixtures = readFixtures();
    const next = options.callLabel === 'pr-planner'
      ? (fixtures.runs.shift() || fixtures.agenticRuns?.shift())
      : fixtures.agenticRuns?.shift();
    if (!next) {
      throw new Error('No mock runtime response remaining for runAgenticReview()');
    }

    writeFixtures(fixtures);
    appendLog({
      type: 'runAgenticReview',
      model: options.model,
      reasoningEffort: options.reasoningEffort,
      reasoningOverrides: options.reasoningOverrides,
      repoPath: options.repoPath,
      initialFiles: options.initialFiles || [],
      maxSteps: options.maxSteps,
      deepMode: options.deepMode,
      disableSubagents: options.disableSubagents,
      callLabel: options.callLabel,
      promptPreview: options.systemPrompt.slice(0, 80),
    });

    const responseData = options.callLabel === 'pr-planner'
      ? normalizePlannerFixtureData(next.data)
      : next.data;

    return {
      data: schema.parse(responseData),
      model: next.model || options.model,
      runtime: next.runtime || 'cli',
      durationMs: 0,
      rawResponse: next.rawResponse || JSON.stringify(next.data),
      tokensUsed: next.tokensUsed,
    };
  }

  async listModels(provider: string, _apiKey?: string, _apiBaseUrl?: string): Promise<string[]> {
    const fixtures = readFixtures();
    appendLog({ type: 'listModels', provider });
    return fixtures.models?.[provider] || [];
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }
}
