import { z } from 'zod';

/** Configuration for a single LLM call, including model routing and prompt content */
export interface RunOptions {
  systemPrompt: string;
  userMessage: string;
  model: string;       // e.g. "anthropic/claude-sonnet-4-5"
  apiKey: string;
  cwd?: string;
  transport?: string;  // e.g. "vercel" when routing anthropic/openai models through a gateway
  apiBaseUrl?: string; // Override for OpenAI-compatible gateways
  maxTokens?: number;
  temperature?: number;
  /** Human-readable label for diagnostics (e.g. reviewer name). Shown in runtime log lines. */
  callLabel?: string;
  /** Per-call timeout in milliseconds. Defaults to 120 000 when not set. */
  timeoutMs?: number;
}

export interface AgenticPRReviewOptions extends RunOptions {
  repoPath: string;
  changedFiles: string[];
  timeoutMs?: number;
}

export interface AgenticRepositoryReviewOptions extends RunOptions {
  repoPath: string;
  initialFiles?: string[];
  timeoutMs?: number;
}

/** Token usage for a single LLM call */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** True when counts are estimated from character length rather than reported by the API */
  estimated?: boolean;
}

/** Result wrapper returned by IRuntime.run, including parsed data and execution metadata */
export interface RunResult<T> {
  data: T;
  model: string;
  runtime: 'sdk' | 'cli';
  durationMs: number;
  rawResponse: string;
  tokensUsed?: TokenUsage;
}

/**
 * Abstract runtime for executing structured LLM calls.
 * Implementations include DirectAIRuntime (Vercel AI SDK) and CLI-based runtimes.
 */
export interface IRuntime {
  run<T>(options: RunOptions, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<RunResult<T>>;
  runAgenticReview<T>(options: AgenticRepositoryReviewOptions, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<RunResult<T>>;
  listModels(provider: string, apiKey: string, apiBaseUrl?: string): Promise<string[]>;
  isAvailable(): Promise<boolean>;
}

/**
 * Parses a model string (e.g. "anthropic/claude-sonnet-4-5") into provider and model ID components.
 * Infers provider from model name prefix if no slash is present (e.g. "claude-*" → anthropic).
 */
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

/** Normalizes a transport string to lowercase, or returns "auto" if undefined or empty. */
export function normalizeTransport(transport?: string): string {
  return transport?.trim().toLowerCase() || 'auto';
}

/**
 * Resolves the effective transport and model ID from a model string and optional transport override.
 *
 * When transport is 'auto' (or omitted), the provider segment of the model string is used as the
 * transport (e.g. "anthropic/claude-sonnet-4-5" → transport="anthropic", modelId="claude-sonnet-4-5").
 *
 * When an explicit transport is provided and it differs from the model string's provider prefix,
 * the full model string (including provider prefix) is passed as the modelId so the gateway can
 * route it correctly (e.g. transport="vercel", model="anthropic/claude-sonnet-4-5" → modelId="anthropic/claude-sonnet-4-5").
 */
export function resolveModelTarget(
  modelString: string,
  transport?: string,
): { transport: string; modelId: string } {
  const parsed = parseProviderAndModel(modelString);
  const normalizedTransport = normalizeTransport(transport);

  if (normalizedTransport === 'auto') {
    return {
      transport: parsed.provider,
      modelId: parsed.modelId,
    };
  }

  return {
    transport: normalizedTransport,
    modelId: normalizedTransport === parsed.provider || !modelString.includes('/')
      ? parsed.modelId
      : modelString,
  };
}
