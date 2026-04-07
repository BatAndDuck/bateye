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
  fetchOpenAICompatibleModels,
  OPENAI_API_BASE_URL,
  resolveOpenAICompatibleBaseUrl,
  resolveOpenAICompatibleModelId,
  resolveVercelGatewayCredential,
  VERCEL_AI_GATEWAY_BASE_URL,
} from '../provider-routing';
import { buildStructureRepairPrompt, extractJsonFromText, formatZodErrors, tryParseAndValidate } from '../structure-repair';
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

  // Detect model-not-found patterns and hint about the models command.
  // Patterns: Anthropic "model: <name>", generic "model not found", "model X does not exist".
  if (/\bmodel[: ]+\S+.*not (found|exist|supported|available)/i.test(message)
    || /model does not exist/i.test(message)
    || /^model: \S/i.test(message)) {
    return new Error(
      `${message}\nHint: run \`bateye models --provider <provider> --apikey <key>\` to list available models.`
    );
  }

  return err instanceof Error ? err : new Error(message);
}

/**
 * Detects errors indicating the model does not support structured output (JSON schema mode).
 * Used to trigger fallback from generateObject to generateText + manual JSON extraction.
 */
function isStructuredOutputError(err: unknown): boolean {
  const msg = formatErrorWithCauses(err).toLowerCase();
  return (
    /does not support (object|structured[- ]?output) generation/.test(msg)
    || /response_format.{0,40}not (supported|available)/.test(msg)
    || /not (supported|available).{0,40}response_format/.test(msg)
    || /json_schema.{0,40}not (supported|available)/.test(msg)
    || /unsupported.{0,30}response_format/.test(msg)
    || /unsupported.{0,30}tool_choice/.test(msg)
    || /tool_choice.{0,40}not (supported|available)/.test(msg)
    || /model does not support.{0,20}json/.test(msg)
    // Generic "Invalid input" from gateways (e.g. Vercel) when passing response_format
    // to a model that doesn't support it. Only match short messages to avoid false positives.
    || (msg.includes('invalid input') && msg.length < 200)
    // Schema constraint errors: providers that support structured output but reject specific
    // JSON schema keywords (minimum, maximum, minLength, maxLength, minItems, maxItems, etc.).
    // Example — Anthropic: "output_config.format.schema: For 'number' type, properties maximum, minimum are not supported"
    || /\b(minimum|maximum|minlength|maxlength|minitems|maxitems)\b.{0,60}not supported/i.test(msg)
    || /not supported.{0,60}\b(minimum|maximum|minlength|maxlength|minitems|maxitems)\b/i.test(msg)
    || /properties.{0,60}\b(minimum|maximum|minlength|maxlength|minitems|maxitems)\b.{0,60}not supported/i.test(msg)
    || /output_config\.format\.schema/.test(msg)
    // Vercel AI SDK errors thrown when generateObject cannot produce valid structured output after repair.
    // Treat these as structured output failures so the text-based fallback is attempted instead.
    || msg.includes('no object generated')
    || msg.includes('no content generated')
    || msg.includes('json parsing failed')
    || msg.includes('type validation failed')
  );
}

/**
 * Detects errors indicating the model rejected the temperature parameter.
 * Reasoning/thinking models often require specific temperature values or ignore the parameter entirely.
 */
function isTemperatureError(err: unknown): boolean {
  const msg = formatErrorWithCauses(err).toLowerCase();
  return (
    /temperature.{0,30}not (supported|allowed|valid|available)/.test(msg)
    || /unsupported.{0,30}temperature/.test(msg)
    || /temperature must be/.test(msg)
    || /temperature is not/.test(msg)
    || /invalid.{0,20}temperature/.test(msg)
  );
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

    const repair = buildStructureRepairPrompt(text, formatZodErrors(error));
    const repairOpts = {
      model,
      system: repair.systemPrompt,
      prompt: repair.userMessage,
      maxOutputTokens: options.maxTokens || 8096,
      timeout: Math.min(options.timeoutMs ?? MAX_ORCHESTRATOR_TIMEOUT_MS, 60_000),
      maxRetries: 0,
    };

    try {
      const result = await generateText({ ...repairOpts, temperature: 0 });
      return result.text.trim() || null;
    } catch (repairErr) {
      // If temperature was rejected, retry without it
      if (isTemperatureError(repairErr)) {
        try {
          const result = await generateText(repairOpts);
          return result.text.trim() || null;
        } catch (retryErr) {
          logRuntimeDebug(
            `[vercel-ai-sdk] ✗ AI repair call failed for ${callId}: ${formatErrorWithCauses(retryErr)}`
          );
          return null;
        }
      }
      logRuntimeDebug(
        `[vercel-ai-sdk] ✗ AI repair call failed for ${callId}: ${formatErrorWithCauses(repairErr)}`
      );
      return null;
    }
  };
}

/**
 * Fallback path when generateObject fails because the model does not support structured output.
 * Uses generateText with the same prompts (which already instruct JSON output), then extracts
 * and validates JSON from the response text. Attempts AI-powered repair on validation failure.
 */
async function fallbackGenerateText<T>(
  prepared: PreparedModel,
  boundedPrompts: BoundedPrompts,
  options: RunOptions,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  callId: string,
  labelTag: string,
  omitTemperature: boolean,
): Promise<{ object: T; usage?: { inputTokens?: number; outputTokens?: number } }> {
  logRuntimeDebug(
    `[vercel-ai-sdk]${labelTag} Falling back to text generation + JSON extraction for ${callId}`
  );

  const textResult = await generateText({
    model: prepared.model,
    system: boundedPrompts.systemPrompt,
    prompt: boundedPrompts.userMessage,
    maxOutputTokens: options.maxTokens || 8096,
    ...(!omitTemperature && options.temperature !== undefined ? { temperature: options.temperature } : {}),
    timeout: options.timeoutMs ?? MAX_ORCHESTRATOR_TIMEOUT_MS,
    maxRetries: 0,
  });

  const rawText = textResult.text ?? '';
  const jsonStr = extractJsonFromText(rawText);
  const parsed = tryParseAndValidate<T>(jsonStr, schema);

  if ('data' in parsed) {
    logRuntimeDebug(`[vercel-ai-sdk]${labelTag} Text fallback succeeded for ${callId}`);
    return { object: parsed.data, usage: textResult.usage as { inputTokens?: number; outputTokens?: number } | undefined };
  }

  // Validation failed — attempt AI repair
  logRuntimeDebug(`[vercel-ai-sdk]${labelTag} Text fallback JSON invalid for ${callId}, attempting repair...`);
  const repair = buildStructureRepairPrompt(jsonStr, formatZodErrors(parsed.error));

  try {
    const repairResult = await generateText({
      model: prepared.model,
      system: repair.systemPrompt,
      prompt: repair.userMessage,
      maxOutputTokens: options.maxTokens || 8096,
      ...(!omitTemperature && options.temperature !== undefined ? { temperature: options.temperature } : {}),
      timeout: Math.min(options.timeoutMs ?? MAX_ORCHESTRATOR_TIMEOUT_MS, 60_000),
      maxRetries: 0,
    });

    const repairedJson = extractJsonFromText(repairResult.text ?? '');
    const repairedParsed = tryParseAndValidate<T>(repairedJson, schema);

    if ('data' in repairedParsed) {
      logRuntimeDebug(`[vercel-ai-sdk]${labelTag} Text fallback repair succeeded for ${callId}`);
      return { object: repairedParsed.data, usage: repairResult.usage as { inputTokens?: number; outputTokens?: number } | undefined };
    }
  } catch (repairErr) {
    logRuntimeDebug(
      `[vercel-ai-sdk]${labelTag} Text fallback repair call failed for ${callId}: ${formatErrorWithCauses(repairErr)}`
    );
  }

  // Both extraction and repair failed — throw the original validation error
  throw parsed.error;
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
        // useDeploymentBasedUrls produces {baseURL}/deployments/{model}/chat/completions,
        // which is the correct URL structure for both Azure OpenAI and Azure AI Foundry.
        // Without this flag, @ai-sdk/azure v3 generates {baseURL}/v1/responses (Responses API)
        // which is not supported on cognitiveservices.azure.com endpoints.
        useDeploymentBasedUrls: true,
        ...(explicitApiBaseUrl
          ? { baseURL: explicitApiBaseUrl }
          : { resourceName }),
      });

      return {
        model: provider.chat(target.modelId),
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
    normalizedTransport,
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

    const buildResult = (result: { object: T; usage?: { inputTokens?: number; outputTokens?: number } }): RunResult<T> => {
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
    };

    const generateObjectOpts = {
      model: prepared.model,
      schema,
      schemaName: 'BatEyeResponse',
      schemaDescription: 'Structured JSON response required by BatEye.',
      system: boundedPrompts.systemPrompt,
      prompt: boundedPrompts.userMessage,
      maxOutputTokens: options.maxTokens || 8096,
      timeout: options.timeoutMs ?? MAX_ORCHESTRATOR_TIMEOUT_MS,
      maxRetries: 0,
      experimental_repairText: buildRepairTextFunction(options, prepared.model, callId),
    };

    // Tier 1: generateObject with all options (native structured output)
    try {
      const result = await generateObjectUntyped({
        ...generateObjectOpts,
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      });
      return buildResult(result);
    } catch (tier1Err) {
      // Tier 2: If temperature was rejected, retry generateObject without it
      if (options.temperature !== undefined && isTemperatureError(tier1Err)) {
        logRuntimeDebug(`[vercel-ai-sdk]${labelTag} Temperature rejected by ${callId}, retrying without temperature...`);
        try {
          const result = await generateObjectUntyped(generateObjectOpts);
          return buildResult(result);
        } catch (tier2Err) {
          // If also a structured output error, fall through to Tier 3
          if (isStructuredOutputError(tier2Err)) {
            return buildResult(
              await fallbackGenerateText(prepared, boundedPrompts, options, schema, callId, labelTag, true),
            );
          }
          throw normalizeRuntimeError(tier2Err, prepared.baseURL);
        }
      }

      // Tier 3: If structured output was rejected, fall back to generateText + JSON extraction
      if (isStructuredOutputError(tier1Err)) {
        const omitTemp = options.temperature !== undefined && isTemperatureError(tier1Err);
        return buildResult(
          await fallbackGenerateText(prepared, boundedPrompts, options, schema, callId, labelTag, omitTemp),
        );
      }

      throw normalizeRuntimeError(tier1Err, prepared.baseURL);
    }
  }

  async listModels(provider: string, apiKey: string, apiBaseUrl?: string): Promise<string[]> {
    const normalizedProvider = normalizeTransport(provider);

    // Vercel AI Gateway is OpenAI-compatible; query its /v1/models endpoint directly
    // since OpenCode's listModels intentionally skips the vercel transport.
    if (normalizedProvider === 'vercel') {
      const credential = resolveVercelGatewayCredential(apiKey);
      const baseUrl = apiBaseUrl?.trim() || VERCEL_AI_GATEWAY_BASE_URL;
      return fetchOpenAICompatibleModels(credential || '', baseUrl);
    }

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
