import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createMistral } from '@ai-sdk/mistral';
import { createOpenAI } from '@ai-sdk/openai';
import { createGateway, generateObject, generateText, type LanguageModel } from 'ai';
import { z } from 'zod';
import { MAX_ORCHESTRATOR_TIMEOUT_MS } from '../../config/defaults';
import { logRuntimeDebug } from '../debug';
import { formatErrorWithCauses } from '../error-format';
import {
  AgenticRepositoryReviewOptions,
  IRuntime,
  parseProviderAndModel,
  RunOptions,
  RunResult,
  TokenUsage,
  normalizeTransport,
  resolveModelTarget,
} from '../interface';
import {
  MISTRAL_API_BASE_URL,
  OPENAI_API_BASE_URL,
  resolveVercelGatewayCredential,
  VERCEL_AI_GATEWAY_BASE_URL,
} from '../provider-routing';
import { buildStructureRepairPrompt, extractJsonFromText, formatZodErrors, tryParseAndValidate } from '../structure-repair';
import {
  fetchCodebiteProviderModels,
  formatSupportedCodebiteProviders,
  normalizeCodebiteProvider,
  type CodebiteProvider,
} from '../codebite/models';

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

/**
 * Maps a generic reasoningEffort string to Google Gemini's token-budget parameter.
 * Returns undefined for unrecognized values so the whole Google provider-options block is omitted.
 */
function effortToGoogleBudget(effort: string): number | undefined {
  switch (effort.toLowerCase()) {
    case 'minimal':
    case 'none':
      return 0;
    case 'low':
      return 2048;
    case 'medium':
      return 8192;
    case 'high':
      return 24576;
    case 'xhigh':
      return 32768;
    default:
      return undefined;
  }
}

/**
 * Per-provider options passed to generateObject/generateText. The Vercel AI SDK
 * expects a `SharedV3ProviderOptions` (Record<string, JSONObject>) but that type
 * rejects arbitrary `unknown` nesting, so we model the shape explicitly and cast
 * at the call site.
 */
type ProviderOptionsMap = Record<string, Record<string, unknown>>;

/**
 * Builds a Vercel AI SDK `providerOptions` object for the given transport and reasoning effort.
 * Returns undefined when effort is falsy or the transport does not support reasoning — in
 * which case the caller must omit `providerOptions` entirely from the generateObject call.
 */
export function buildProviderOptions(
  transport: string,
  effort: string | undefined,
): ProviderOptionsMap | undefined {
  if (!effort || typeof effort !== 'string') {
    return undefined;
  }

  switch (normalizeTransport(transport)) {
    case 'openai':
      return { openai: { reasoningEffort: effort } };
    case 'vercel':
      // Vercel AI Gateway is OpenAI-compatible; the OpenAI provider-options
      // shape passes through to the gateway for reasoning-capable models.
      return { openai: { reasoningEffort: effort } };
    case 'anthropic':
      // Claude 4.6+ adaptive thinking. Older Claude versions will reject the
      // call — per user decision, we fail loudly rather than silently fall back.
      return { anthropic: { thinking: { type: 'adaptive', effort } } };
    case 'google':
    case 'gemini': {
      const budget = effortToGoogleBudget(effort);
      if (budget === undefined) {
        return undefined;
      }
      return { google: { thinkingConfig: { thinkingBudget: budget } } };
    }
    case 'mistral': {
      const reasoningEffort = effortToMistralReasoning(effort);
      return reasoningEffort ? { mistral: { reasoningEffort } } : undefined;
    }
    default:
      return undefined;
  }
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

function normalizeRuntimeError(err: unknown, transport: string): Error {
  const message = formatErrorWithCauses(err);
  if (normalizeTransport(transport) === 'vercel' && /Error verifying OIDC token/i.test(message)) {
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

function resolveDirectProvider(options: RunOptions): {
  provider: CodebiteProvider;
  modelId: string;
} {
  const parsed = parseProviderAndModel(options.model);
  const parsedProvider = normalizeCodebiteProvider(parsed.provider);
  const target = resolveModelTarget(options.model, options.transport);
  const requestedTransport = normalizeTransport(options.transport);
  const normalizedTransport = normalizeTransport(target.transport);
  const provider = normalizeCodebiteProvider(normalizedTransport);

  if (options.model.includes('/') && !parsedProvider) {
    throw new Error(
      `Model prefix "${parsed.provider}" is not supported. `
      + `Supported providers: ${formatSupportedCodebiteProviders()}.`
    );
  }

  if (!provider) {
    throw new Error(
      `Transport "${normalizedTransport}" is not supported. `
      + `Supported providers: ${formatSupportedCodebiteProviders()}.`
    );
  }

  if (requestedTransport !== 'auto' && provider !== 'vercel' && parsedProvider && provider !== parsedProvider) {
    throw new Error(
      `Transport "${normalizedTransport}" cannot route model "${options.model}". `
      + 'Only the Vercel transport can override the model provider prefix.'
    );
  }

  if (provider === 'vercel' && !target.modelId.includes('/')) {
    throw new Error(
      'Vercel transport requires a model in provider/model format, '
      + 'for example "openai/gpt-5.4-nano" or "vercel/openai/gpt-5.4-nano".'
    );
  }

  if (provider === 'vercel') {
    const gatewayTarget = parseProviderAndModel(target.modelId);
    const gatewayProvider = normalizeCodebiteProvider(gatewayTarget.provider);
    if (!gatewayProvider || gatewayProvider === 'vercel') {
      throw new Error(
        `Vercel transport only supports routed models from ${formatSupportedCodebiteProviders().replace(', vercel', '')}.`
      );
    }
  }

  return {
    provider,
    modelId: target.modelId,
  };
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

  const providerOptions = buildProviderOptions(prepared.transport, options.reasoningEffort);

  // Mirrors `generateObjectUntyped` — the SDK's `providerOptions` expects a
  // deeply-typed JSONObject shape but validates per-provider at runtime, so we
  // relax the compile-time signature here.
  const generateTextUntyped = generateText as unknown as (
    opts: Record<string, unknown>,
  ) => Promise<{ text?: string; usage?: { inputTokens?: number; outputTokens?: number } }>;

  const textResult = await generateTextUntyped({
    model: prepared.model,
    system: boundedPrompts.systemPrompt,
    prompt: boundedPrompts.userMessage,
    maxOutputTokens: options.maxTokens || 8096,
    ...(!omitTemperature && options.temperature !== undefined ? { temperature: options.temperature } : {}),
    timeout: options.timeoutMs ?? MAX_ORCHESTRATOR_TIMEOUT_MS,
    maxRetries: 0,
    ...(providerOptions ? { providerOptions } : {}),
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
    const repairResult = await generateTextUntyped({
      model: prepared.model,
      system: repair.systemPrompt,
      prompt: repair.userMessage,
      maxOutputTokens: options.maxTokens || 8096,
      ...(!omitTemperature && options.temperature !== undefined ? { temperature: options.temperature } : {}),
      timeout: Math.min(options.timeoutMs ?? MAX_ORCHESTRATOR_TIMEOUT_MS, 60_000),
      maxRetries: 0,
      ...(providerOptions ? { providerOptions } : {}),
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

export function prepareModel(options: RunOptions): PreparedModel {
  const { provider, modelId } = resolveDirectProvider(options);
  const explicitApiBaseUrl = normalizeBaseUrl(options.apiBaseUrl);

  switch (provider) {
    case 'vercel': {
      const apiKey = resolveVercelGatewayCredential(options.apiKey, options.cwd);
      if (!apiKey) {
        throw new Error(
          'Vercel AI Gateway requires a credential. Set BATEYE_LLM_MODEL_API_KEY, AI_GATEWAY_API_KEY, or VERCEL_OIDC_TOKEN.'
        );
      }

      const gateway = createGateway({
        apiKey,
        ...(explicitApiBaseUrl ? { baseURL: explicitApiBaseUrl } : {}),
      });

      return {
        model: gateway(modelId),
        transport: provider,
        modelId,
        baseURL: explicitApiBaseUrl || VERCEL_AI_GATEWAY_BASE_URL,
      };
    }
    case 'openai': {
      const openai = createOpenAI({
        apiKey: options.apiKey,
        ...(explicitApiBaseUrl ? { baseURL: explicitApiBaseUrl } : {}),
      });

      return {
        model: openai(modelId),
        transport: provider,
        modelId,
        baseURL: explicitApiBaseUrl || OPENAI_API_BASE_URL,
      };
    }
    case 'anthropic': {
      const anthropic = createAnthropic({
        apiKey: options.apiKey,
        ...(explicitApiBaseUrl ? { baseURL: explicitApiBaseUrl } : {}),
      });
      return {
        model: anthropic(modelId),
        transport: provider,
        modelId,
        baseURL: explicitApiBaseUrl,
      };
    }
    case 'google': {
      const google = createGoogleGenerativeAI({
        apiKey: options.apiKey,
        ...(explicitApiBaseUrl ? { baseURL: explicitApiBaseUrl } : {}),
      });
      return {
        model: google(modelId),
        transport: provider,
        modelId,
        baseURL: explicitApiBaseUrl,
      };
    }
    case 'mistral': {
      const mistral = createMistral({
        apiKey: options.apiKey,
        ...(explicitApiBaseUrl ? { baseURL: explicitApiBaseUrl } : {}),
      });
      return {
        model: mistral(modelId),
        transport: provider,
        modelId,
        baseURL: explicitApiBaseUrl || MISTRAL_API_BASE_URL,
      };
    }
  }
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

    const providerOptions = buildProviderOptions(prepared.transport, options.reasoningEffort);
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
      ...(providerOptions ? { providerOptions } : {}),
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
          throw normalizeRuntimeError(tier2Err, prepared.transport);
        }
      }

      // Tier 3: If structured output was rejected, fall back to generateText + JSON extraction
      if (isStructuredOutputError(tier1Err)) {
        const omitTemp = options.temperature !== undefined && isTemperatureError(tier1Err);
        return buildResult(
          await fallbackGenerateText(prepared, boundedPrompts, options, schema, callId, labelTag, omitTemp),
        );
      }

      throw normalizeRuntimeError(tier1Err, prepared.transport);
    }
  }

  async listModels(provider: string, apiKey: string, apiBaseUrl?: string): Promise<string[]> {
    return fetchCodebiteProviderModels(provider, apiKey, apiBaseUrl);
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async runAgenticReview<T>(_options: AgenticRepositoryReviewOptions, _schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<RunResult<T>> {
    throw new Error(
      'Agentic repository review requires the Codebite runtime or BATEYE_RUNTIME=mock. '
      + 'The Vercel AI SDK runtime cannot inspect the repository before reporting findings.'
    );
  }
}

function effortToMistralReasoning(effort: string): 'none' | 'high' | undefined {
  switch (effort.toLowerCase()) {
    case 'none':
    case 'minimal':
      return 'none';
    case 'high':
    case 'xhigh':
      return 'high';
    default:
      return undefined;
  }
}
