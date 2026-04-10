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
    const next = fixtures.agenticRuns?.shift();
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
      promptPreview: options.systemPrompt.slice(0, 80),
    });

    return {
      data: schema.parse(next.data),
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
