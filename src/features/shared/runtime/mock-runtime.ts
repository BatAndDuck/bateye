import * as fs from 'fs';
import { z } from 'zod';
import { AgenticPRReviewOptions, IRuntime, RunOptions, RunResult } from '../../../core/runtime/interface';

type MockRuntimeFixtures = {
  runs: Array<{
    data: unknown;
    model?: string;
    runtime?: 'sdk' | 'cli';
    rawResponse?: string;
  }>;
  agenticRuns?: Array<{
    data: unknown;
    model?: string;
    runtime?: 'sdk' | 'cli';
    rawResponse?: string;
  }>;
  models?: Record<string, string[]>;
};

function readFixtures(): MockRuntimeFixtures {
  const fixturePath = process.env.CODEOWL_MOCK_RUNTIME_FIXTURES;
  if (!fixturePath) {
    throw new Error('CODEOWL_MOCK_RUNTIME_FIXTURES is required when CODEOWL_RUNTIME=mock');
  }

  return JSON.parse(fs.readFileSync(fixturePath, 'utf-8')) as MockRuntimeFixtures;
}

function writeFixtures(fixtures: MockRuntimeFixtures): void {
  const fixturePath = process.env.CODEOWL_MOCK_RUNTIME_FIXTURES;
  if (!fixturePath) {
    throw new Error('CODEOWL_MOCK_RUNTIME_FIXTURES is required when CODEOWL_RUNTIME=mock');
  }

  fs.writeFileSync(fixturePath, JSON.stringify(fixtures, null, 2) + '\n', 'utf-8');
}

function appendLog(entry: unknown): void {
  const logPath = process.env.CODEOWL_MOCK_RUNTIME_LOG;
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
    appendLog({ type: 'run', model: options.model, promptPreview: options.systemPrompt.slice(0, 80) });

    return {
      data: schema.parse(next.data),
      model: next.model || options.model,
      runtime: next.runtime || 'sdk',
      durationMs: 0,
      rawResponse: next.rawResponse || JSON.stringify(next.data),
    };
  }

  async runAgenticPRReview<T>(options: AgenticPRReviewOptions, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<RunResult<T>> {
    const fixtures = readFixtures();
    const next = fixtures.agenticRuns?.shift();
    if (!next) {
      throw new Error('No mock runtime response remaining for runAgenticPRReview()');
    }

    writeFixtures(fixtures);
    appendLog({
      type: 'runAgenticPRReview',
      model: options.model,
      repoPath: options.repoPath,
      changedFiles: options.changedFiles,
      promptPreview: options.systemPrompt.slice(0, 80),
    });

    return {
      data: schema.parse(next.data),
      model: next.model || options.model,
      runtime: next.runtime || 'cli',
      durationMs: 0,
      rawResponse: next.rawResponse || JSON.stringify(next.data),
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
