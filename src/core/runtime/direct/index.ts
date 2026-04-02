import { createAnthropic } from '@ai-sdk/anthropic';
import { createAzure } from '@ai-sdk/azure';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateObject, generateText, type LanguageModel } from 'ai';
import { z } from 'zod';
import { MAX_ORCHESTRATOR_TIMEOUT_MS } from '../../config/defaults';
import { logRuntimeDebug } from '../debug';
import { formatErrorWithCauses } from '../error-format';
import {
  AgenticRepositoryReviewOptions,
  IRuntime,
  RunOptions,
  RunResult,
  TokenUsage,
  normalizeTransport,
  resolveModelTarget,
} from '../interface';
import {
  OPENAI_API_BASE_URL,
  resolveOpenAICompatibleBaseUrl,
  resolveOpenAICompatibleModelId,
  resolveVercelGatewayCredential,
  VERCEL_AI_GATEWAY_BASE_URL,
} from '../provider-routing';
import { buildStructureRepairPrompt, formatZodErrors } from '../structure-repair';
import { OpenCodeCLIRuntime } from '../opencode-cli/index';

type PreparedModel = {
  model: LanguageModel;
  transport: string;
  modelId: string;
  baseURL?: string;
};

type BoundedPrompts = {
  systemPrompt: string;
  userMessage: string;
  truncated: boolean;
  originalChars: number;
  boundedChars: number;
};

const DEFAULT_MAX_INPUT_CHARS = 96_000;
const DEFAULT_MAX_SYSTEM_PROMPT_CHARS = 16_000;

function normalizeBaseUrl(baseURL?: string): string | undefined {
  const trimmed = baseURL?.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.replace(/\/+$/, '');
}

function truncateWithMarker(text: string, maxChars: number, label: string): string {
  if (text.length <= maxChars) {
    return text;
  }

  const marker = `\n\n[...${label} truncated by BatEye...]\n\n`;
  if (maxChars <= marker.length + 32) {
    return text.slice(0, maxChars);
  }

  const head = Math.ceil((maxChars - marker.length) * 0.7);
  const tail = maxChars - marker.length - head;
  return text.slice(0, head) + marker + text.slice(text.length - tail);
}

function boundPrompts(options: RunOptions): BoundedPrompts {
  const originalChars = options.systemPrompt.length + options.userMessage.length;
  const maxInputChars = options.maxInputChars ?? DEFAULT_MAX_INPUT_CHARS;

  if (originalChars <= maxInputChars) {
    return {
      systemPrompt: options.systemPrompt,
      userMessage: options.userMessage,
      truncated: false,
      originalChars,
      boundedChars: originalChars,
    };
  }

  const minimumSegmentChars = Math.min(512, Math.max(Math.floor(maxInputChars / 4), 0));
  let systemBudget = Math.floor(maxInputChars * (options.systemPrompt.length / originalChars));
  systemBudget = Math.max(systemBudget, Math.min(minimumSegmentChars, options.systemPrompt.length));
  systemBudget = Math.min(systemBudget, DEFAULT_MAX_SYSTEM_PROMPT_CHARS);

  if (systemBudget > maxInputChars - minimumSegmentChars) {
    systemBudget = Math.max(maxInputChars - minimumSegmentChars, 0);
  }

  let userBudget = Math.max(maxInputChars - systemBudget, 0);
  if (userBudget < minimumSegmentChars) {
    userBudget = minimumSegmentChars;
    systemBudget = Math.max(maxInputChars - userBudget, 0);
  }

  const boundedSystemPrompt = truncateWithMarker(options.systemPrompt, systemBudget, 'system prompt');
  const boundedUserMessage = truncateWithMarker(options.userMessage, userBudget, 'user message');
  const boundedChars = boundedSystemPrompt.length + boundedUserMessage.length;

  return {
    systemPrompt: boundedSystemPrompt,
    userMessage: boundedUserMessage,
    truncated: true,
    originalChars,
    boundedChars,
  };
}

function usesNativeOpenAIProvider(explicitApiBaseUrl?: string): boolean {
  const normalized = normalizeBaseUrl(explicitApiBaseUrl);
  return !normalized || normalized === OPENAI_API_BASE_URL;
}

function normalizeRuntimeError(err: unknown, baseURL?: string): Error {
  const message = formatErrorWithCauses(err);
  if (baseURL === VERCEL_AI_GATEWAY_BASE_URL && /Error verifying OIDC token/i.test(message)) {
    return new Error(
      'Vercel AI Gateway rejected the configured bearer token for inference. '
      + 'Use an AI Gateway API key created in Vercel AI Gateway, or provide VERCEL_OIDC_TOKEN. '
      + `Original error: ${message}`
    );
  }

  return err instanceof Error ? err : new Error(message);
}

function buildTokenUsage(
  usage: { inputTokens?: number; outputTokens?: number } | undefined,
  options: Pick<RunOptions, 'systemPrompt' | 'userMessage'>,
  rawResponse: string,
): TokenUsage {
  if (
    usage
    && (typeof usage.inputTokens === 'number' || typeof usage.outputTokens === 'number')
  ) {
    return {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      estimated: false,
    };
  }

  return {
    inputTokens: Math.ceil((options.systemPrompt.length + options.userMessage.length) / 4),
    outputTokens: Math.ceil(rawResponse.length / 4),
    estimated: true,
  };
}

function buildRepairTextFunction(
  options: RunOptions,
  model: LanguageModel,
  callId: string,
): ((args: { text: string; error: Error }) => Promise<string | null>) | undefined {
  return async ({ text, error }) => {
    logRuntimeDebug(`[vercel-ai-sdk] Attempting AI structure repair for ${callId}...`);

    try {
      const repair = buildStructureRepairPrompt(text, formatZodErrors(error));
      const result = await generateText({
        model,
        system: repair.systemPrompt,
        prompt: repair.userMessage,
        maxOutputTokens: options.maxTokens || 8096,
        temperature: 0,
        timeout: Math.min(options.timeoutMs ?? MAX_ORCHESTRATOR_TIMEOUT_MS, 60_000),
        maxRetries: 0,
      });

      const repairedText = result.text.trim();
      return repairedText || null;
    } catch (repairErr) {
      logRuntimeDebug(
        `[vercel-ai-sdk] ✗ AI repair call failed for ${callId}: ${(repairErr as Error).message.slice(0, 200)}`
      );
      return null;
    }
  };
}

function prepareModel(options: RunOptions): PreparedModel {
  const target = resolveModelTarget(options.model, options.transport);
  const normalizedTransport = normalizeTransport(target.transport);
  const explicitApiBaseUrl = options.apiBaseUrl?.trim();
  const baseURL = resolveOpenAICompatibleBaseUrl(normalizedTransport, options.apiBaseUrl);

  switch (normalizedTransport) {
    case 'vercel': {
      const apiKey = resolveVercelGatewayCredential(options.apiKey, options.cwd);
      if (!apiKey) {
        throw new Error(
          'Vercel AI Gateway requires a credential. Set BATEYE_LLM_MODEL_API_KEY, AI_GATEWAY_API_KEY, or VERCEL_OIDC_TOKEN.'
        );
      }

      const provider = createOpenAICompatible({
        name: normalizedTransport,
        apiKey,
        baseURL: baseURL || VERCEL_AI_GATEWAY_BASE_URL,
        includeUsage: true,
      });

      return {
        model: provider.chatModel(target.modelId),
        transport: normalizedTransport,
        modelId: target.modelId,
        baseURL: baseURL || VERCEL_AI_GATEWAY_BASE_URL,
      };
    }
    case 'openai':
      if (usesNativeOpenAIProvider(explicitApiBaseUrl)) {
        const provider = createOpenAI({
          apiKey: options.apiKey,
          ...(explicitApiBaseUrl ? { baseURL: normalizeBaseUrl(explicitApiBaseUrl) } : {}),
        });

        return {
          model: provider(target.modelId),
          transport: normalizedTransport,
          modelId: target.modelId,
          baseURL: normalizeBaseUrl(explicitApiBaseUrl) || OPENAI_API_BASE_URL,
        };
      }
      break;
    case 'anthropic':
      if (!explicitApiBaseUrl) {
        const provider = createAnthropic({ apiKey: options.apiKey });
        return {
          model: provider(target.modelId),
          transport: normalizedTransport,
          modelId: target.modelId,
        };
      }
      break;
    case 'google':
    case 'gemini':
      if (!explicitApiBaseUrl) {
        const provider = createGoogleGenerativeAI({ apiKey: options.apiKey });
        return {
          model: provider(target.modelId),
          transport: normalizedTransport,
          modelId: target.modelId,
        };
      }
      break;
    case 'azure': {
      const resourceName = process.env['AZURE_RESOURCE_NAME'];
      if (!resourceName && !explicitApiBaseUrl) {
        throw new Error('AZURE_RESOURCE_NAME environment variable is required for Azure OpenAI');
      }

      const provider = createAzure({
        apiKey: options.apiKey,
        apiVersion: process.env['AZURE_API_VERSION'] || '2024-02-01',
        ...(explicitApiBaseUrl
          ? { baseURL: explicitApiBaseUrl }
          : { resourceName }),
      });

      return {
        model: provider(target.modelId),
        transport: normalizedTransport,
        modelId: target.modelId,
        baseURL: explicitApiBaseUrl,
      };
    }
    default:
      break;
  }

  if (!baseURL) {
    throw new Error(
      `No OpenAI-compatible base URL is configured for transport "${normalizedTransport}". `
      + 'Set apiBaseUrl or use a built-in provider transport.'
    );
  }

  const openAICompatibleModelId = resolveOpenAICompatibleModelId(
    options.model,
    target.modelId,
    options.apiBaseUrl,
  );
  const provider = createOpenAICompatible({
    name: normalizedTransport,
    apiKey: options.apiKey,
    baseURL,
    includeUsage: true,
  });

  return {
    model: provider.chatModel(openAICompatibleModelId),
    transport: normalizedTransport,
    modelId: openAICompatibleModelId,
    baseURL,
  };
}

export { resolveVercelGatewayCredential } from '../provider-routing';

export class DirectAIRuntime implements IRuntime {
  async run<T>(options: RunOptions, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<RunResult<T>> {
    const prepared = prepareModel(options);
    const boundedPrompts = boundPrompts(options);
    const start = Date.now();
    const estimatedInputTokens = Math.ceil(boundedPrompts.boundedChars / 4);
    const callId = `${prepared.transport}/${prepared.modelId}`;
    const labelTag = options.callLabel ? ` [${options.callLabel}]` : '';
    const generateObjectUntyped = generateObject as unknown as (
      callOptions: Record<string, unknown>,
    ) => Promise<{ object: T; usage?: { inputTokens?: number; outputTokens?: number } }>;

    if (boundedPrompts.truncated) {
      logRuntimeDebug(
        `[vercel-ai-sdk]${labelTag} Input prompts truncated from ${boundedPrompts.originalChars} to ${boundedPrompts.boundedChars} chars before model=${callId}`
      );
    }

    logRuntimeDebug(
      `[vercel-ai-sdk]${labelTag} Starting call: model=${callId}, systemPrompt=${boundedPrompts.systemPrompt.length} chars, `
      + `userMessage=${boundedPrompts.userMessage.length} chars, estInputTokens=~${estimatedInputTokens}`
    );

    try {
      const result = await generateObjectUntyped({
        model: prepared.model,
        schema,
        schemaName: 'BatEyeResponse',
        schemaDescription: 'Structured JSON response required by BatEye.',
        system: boundedPrompts.systemPrompt,
        prompt: boundedPrompts.userMessage,
        maxOutputTokens: options.maxTokens || 8096,
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
        timeout: options.timeoutMs ?? MAX_ORCHESTRATOR_TIMEOUT_MS,
        maxRetries: 0,
        experimental_repairText: buildRepairTextFunction(options, prepared.model, callId),
      });

      const rawResponse = JSON.stringify(result.object);
      const tokensUsed = buildTokenUsage(result.usage, boundedPrompts, rawResponse);
      const durationMs = Date.now() - start;
      const tokenSummary = tokensUsed.estimated
        ? `~${tokensUsed.inputTokens} in + ~${tokensUsed.outputTokens} out (estimated)`
        : `${tokensUsed.inputTokens} in + ${tokensUsed.outputTokens} out`;

      logRuntimeDebug(
        `[vercel-ai-sdk]${labelTag} ✓ ${callId} completed in ${(durationMs / 1000).toFixed(1)}s: ${tokenSummary}`
      );

      return {
        data: result.object,
        model: options.model,
        runtime: 'sdk',
        durationMs,
        rawResponse,
        tokensUsed,
      };
    } catch (err) {
      throw normalizeRuntimeError(err, prepared.baseURL);
    }
  }

  async listModels(provider: string, apiKey: string, apiBaseUrl?: string): Promise<string[]> {
    const runtime = new OpenCodeCLIRuntime();
    return runtime.listModels(provider, apiKey, apiBaseUrl);
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async runAgenticReview<T>(_options: AgenticRepositoryReviewOptions, _schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<RunResult<T>> {
    throw new Error(
      'Agentic repository review requires the OpenCode CLI runtime or BATEYE_RUNTIME=mock. '
      + 'The Vercel AI SDK runtime cannot inspect the repository before reporting findings.'
    );
  }
}
