import { z } from 'zod';

export interface RunOptions {
  systemPrompt: string;
  userMessage: string;
  model: string;       // e.g. "anthropic/claude-sonnet-4-5"
  apiKey: string;
  maxTokens?: number;
  temperature?: number;
}

export interface RunResult<T> {
  data: T;
  model: string;
  runtime: 'sdk' | 'cli';
  durationMs: number;
  rawResponse: string;
}

export interface IRuntime {
  run<T>(options: RunOptions, schema: z.ZodSchema<T>): Promise<RunResult<T>>;
  listModels(provider: string, apiKey: string): Promise<string[]>;
  isAvailable(): Promise<boolean>;
}

export function parseProviderAndModel(modelString: string): { provider: string; modelId: string } {
  const slashIdx = modelString.indexOf('/');
  if (slashIdx === -1) {
    // Try to infer provider from model name
    if (modelString.startsWith('claude')) return { provider: 'anthropic', modelId: modelString };
    if (modelString.startsWith('gpt') || modelString.startsWith('o1') || modelString.startsWith('o3')) return { provider: 'openai', modelId: modelString };
    if (modelString.startsWith('gemini')) return { provider: 'google', modelId: modelString };
    return { provider: 'openai', modelId: modelString };
  }
  return {
    provider: modelString.slice(0, slashIdx).toLowerCase(),
    modelId: modelString.slice(slashIdx + 1),
  };
}
