import Anthropic from '@anthropic-ai/sdk';
import OpenAI, { AzureOpenAI } from 'openai';
import { MAX_ORCHESTRATOR_TIMEOUT_MS } from '../../config/defaults';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { AgenticRepositoryReviewOptions, IRuntime, RunOptions, RunResult, TokenUsage, normalizeTransport, resolveModelTarget } from '../interface';
import { logRuntimeDebug } from '../debug';
import { formatErrorWithCauses } from '../error-format';
import { buildStructureRepairPrompt, formatZodErrors, tryParseAndValidate, extractJsonFromText } from '../structure-repair';

const MAX_RETRIES = 3;
const VERCEL_AI_GATEWAY_BASE_URL = 'https://ai-gateway.vercel.sh/v1';

function resolveDotEnvValue(name: string, cwd = process.cwd()): string | undefined {
  const fromEnv = process.env[name]?.trim();
  if (fromEnv) return fromEnv;

  // Walk up from cwd looking for a .env file that contains the requested key.
  let dir = cwd;
  for (let i = 0; i < 5; i++) {
    const envFile = path.join(dir, '.env');
    if (fs.existsSync(envFile)) {
      const line = fs.readFileSync(envFile, 'utf-8')
        .split('\n')
        .find(l => l.startsWith(`${name}=`));
      if (line) return line.slice(`${name}=`.length).trim().replace(/^["']|["']$/g, '');
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

function resolveVercelOidcToken(cwd?: string): string | undefined {
  return resolveDotEnvValue('VERCEL_OIDC_TOKEN', cwd);
}

function resolveVercelGatewayApiKey(cwd?: string): string | undefined {
  return resolveDotEnvValue('AI_GATEWAY_API_KEY', cwd);
}

export function resolveVercelGatewayCredential(configuredApiKey?: string, cwd?: string): string | undefined {
  // Prefer the explicitly configured key so a stale pulled OIDC token cannot
  // override a working local gateway API key.
  return configuredApiKey?.trim() || resolveVercelGatewayApiKey(cwd) || resolveVercelOidcToken(cwd);
}

function extractJson(text: string): string {
  // Try to extract JSON from markdown code blocks
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();
  // Try to find raw JSON object/array
  const objMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (objMatch) return objMatch[1];
  return text.trim();
}

function shouldRetryWithoutResponseFormat(err: unknown): boolean {
  const candidate = err as {
    status?: number;
    message?: string;
    error?: {
      param?: string;
      message?: string;
    };
  };

  return candidate?.status === 400 && (
    candidate?.error?.param === 'response_format'
    || /response_format/i.test(candidate?.message || '')
    || /response_format/i.test(candidate?.error?.message || '')
  );
}

function normalizeRuntimeError(err: unknown, baseURL?: string): Error {
  const candidate = err as { error?: { message?: string } };
  const message = candidate?.error?.message || formatErrorWithCauses(err);
  if (baseURL === VERCEL_AI_GATEWAY_BASE_URL && /Error verifying OIDC token/i.test(message)) {
    return new Error(
      'Vercel AI Gateway rejected the configured bearer token for inference. '
      + 'Use an AI Gateway API key created in Vercel AI Gateway, or provide VERCEL_OIDC_TOKEN. '
      + `Original error: ${message}`
    );
  }

  return err instanceof Error ? err : new Error(message);
}

async function runWithAnthropic<T>(
  options: RunOptions,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  modelId: string
): Promise<RunResult<T>> {
  const client = new Anthropic({ apiKey: options.apiKey });
  const start = Date.now();
  const estInputTokens = Math.ceil((options.systemPrompt.length + options.userMessage.length) / 4);

  const labelTag = options.callLabel ? ` [${options.callLabel}]` : '';
  logRuntimeDebug(`[direct-anthropic]${labelTag} Starting call: model=${modelId}, systemPrompt=${options.systemPrompt.length} chars, userMessage=${options.userMessage.length} chars, estInputTokens=~${estInputTokens}`);

  let lastError: Error | null = null;
  let lastRawJson: string | null = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      logRuntimeDebug(`[direct-anthropic] Retry ${attempt + 1}/${MAX_RETRIES} for ${modelId}: ${lastError?.message?.slice(0, 200)}`);
    }

    const retryNote = attempt > 0 ? `\n\nPREVIOUS ATTEMPT FAILED JSON VALIDATION. Return ONLY valid JSON.` : '';
    const response = await client.messages.create({
      model: modelId,
      max_tokens: options.maxTokens || 8096,
      temperature: options.temperature ?? 0,
      system: options.systemPrompt + retryNote,
      messages: [{ role: 'user', content: options.userMessage }],
    });

    const rawText = response.content
      .filter(c => c.type === 'text')
      .map(c => (c as { type: 'text'; text: string }).text)
      .join('');
    const tokensUsed: TokenUsage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };

    const jsonStr = extractJson(rawText);
    try {
      const parsed = JSON.parse(jsonStr);
      const validated = schema.parse(parsed);
      const durationMs = Date.now() - start;
      logRuntimeDebug(`[direct-anthropic] ✓ ${modelId} completed in ${(durationMs / 1000).toFixed(1)}s: ${tokensUsed.inputTokens} in + ${tokensUsed.outputTokens} out (actual), attempt ${attempt + 1}/${MAX_RETRIES}`);
      return {
        data: validated,
        model: modelId,
        runtime: 'sdk',
        durationMs,
        rawResponse: rawText,
        tokensUsed,
      };
    } catch (err) {
      lastError = err as Error;
      lastRawJson = jsonStr;
      logRuntimeDebug(`[direct-anthropic] ✗ ${modelId} validation failed (attempt ${attempt + 1}/${MAX_RETRIES}): ${lastError.message.slice(0, 200)}`);
    }
  }

  // AI structure repair: ask the model to fix the malformed JSON
  if (lastRawJson) {
    logRuntimeDebug(`[direct-anthropic] Attempting AI structure repair for ${modelId}...`);
    try {
      const repair = buildStructureRepairPrompt(lastRawJson, formatZodErrors(lastError));
      const repairResponse = await client.messages.create({
        model: modelId,
        max_tokens: options.maxTokens || 8096,
        temperature: 0,
        system: repair.systemPrompt,
        messages: [{ role: 'user', content: repair.userMessage }],
      });
      const repairText = repairResponse.content
        .filter(c => c.type === 'text')
        .map(c => (c as { type: 'text'; text: string }).text)
        .join('');
      const repairJson = extractJsonFromText(repairText);
      const repairResult = tryParseAndValidate(repairJson, schema);
      if ('data' in repairResult) {
        const durationMs = Date.now() - start;
        logRuntimeDebug(`[direct-anthropic] ✓ AI repair succeeded for ${modelId} in ${(durationMs / 1000).toFixed(1)}s`);
        return {
          data: repairResult.data,
          model: modelId,
          runtime: 'sdk',
          durationMs,
          rawResponse: repairText,
          tokensUsed: {
            inputTokens: repairResponse.usage.input_tokens,
            outputTokens: repairResponse.usage.output_tokens,
          },
        };
      }
      logRuntimeDebug(`[direct-anthropic] ✗ AI repair also failed validation: ${('error' in repairResult ? repairResult.error.message : 'unknown').slice(0, 200)}`);
    } catch (repairErr) {
      logRuntimeDebug(`[direct-anthropic] ✗ AI repair call failed: ${(repairErr as Error).message.slice(0, 200)}`);
    }
  }

  throw new Error(`Failed to get valid JSON after ${MAX_RETRIES} attempts + AI repair: ${lastError?.message}`);
}

async function runWithAzure<T>(
  options: RunOptions,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  modelId: string
): Promise<RunResult<T>> {
  const resourceName = process.env['AZURE_RESOURCE_NAME'];
  if (!resourceName) {
    throw new Error('AZURE_RESOURCE_NAME environment variable is required for Azure OpenAI');
  }
  const client = new AzureOpenAI({
    apiKey: options.apiKey,
    endpoint: `https://${resourceName}.openai.azure.com/`,
    apiVersion: '2024-02-01',
    deployment: modelId,
  });
  const start = Date.now();

  let lastError: Error | null = null;
  let lastRawJson: string | null = null;
  let includeResponseFormat = true;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const retryNote = attempt > 0 ? `\n\nPREVIOUS ATTEMPT FAILED JSON VALIDATION. Return ONLY valid JSON.` : '';
    let response: Awaited<ReturnType<typeof client.chat.completions.create>>;
    try {
      response = await client.chat.completions.create({
        model: modelId,
        max_tokens: options.maxTokens || 8096,
        temperature: options.temperature ?? 0,
        ...(includeResponseFormat ? { response_format: { type: 'json_object' as const } } : {}),
        messages: [
          { role: 'system', content: options.systemPrompt + retryNote },
          { role: 'user', content: options.userMessage },
        ],
      });
    } catch (err) {
      if (includeResponseFormat && shouldRetryWithoutResponseFormat(err)) {
        includeResponseFormat = false;
        attempt -= 1;
        continue;
      }
      throw err;
    }

    const rawText = response.choices[0]?.message?.content || '';
    const tokensUsed: TokenUsage = {
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    };
    const jsonStr = extractJson(rawText);
    try {
      const parsed = JSON.parse(jsonStr);
      const validated = schema.parse(parsed);
      return {
        data: validated,
        model: modelId,
        runtime: 'sdk',
        durationMs: Date.now() - start,
        rawResponse: rawText,
        tokensUsed,
      };
    } catch (err) {
      lastError = err as Error;
      lastRawJson = jsonStr;
    }
  }

  // AI structure repair for Azure
  if (lastRawJson) {
    try {
      const repair = buildStructureRepairPrompt(lastRawJson, formatZodErrors(lastError));
      const repairResponse = await client.chat.completions.create({
        model: modelId,
        max_tokens: options.maxTokens || 8096,
        temperature: 0,
        ...(includeResponseFormat ? { response_format: { type: 'json_object' as const } } : {}),
        messages: [
          { role: 'system', content: repair.systemPrompt },
          { role: 'user', content: repair.userMessage },
        ],
      });
      const repairText = repairResponse.choices[0]?.message?.content || '';
      const repairJson = extractJsonFromText(repairText);
      const repairResult = tryParseAndValidate(repairJson, schema);
      if ('data' in repairResult) {
        return {
          data: repairResult.data,
          model: modelId,
          runtime: 'sdk',
          durationMs: Date.now() - start,
          rawResponse: repairText,
          tokensUsed: {
            inputTokens: repairResponse.usage?.prompt_tokens ?? 0,
            outputTokens: repairResponse.usage?.completion_tokens ?? 0,
          },
        };
      }
    } catch {
      // Fall through to throw
    }
  }

  throw new Error(`Failed to get valid JSON after ${MAX_RETRIES} attempts + AI repair: ${lastError?.message}`);
}

async function runWithOpenAI<T>(
  options: RunOptions,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  modelId: string,
  baseURL?: string
): Promise<RunResult<T>> {
  // Use the caller-supplied timeout or the orchestrator default (10 min).
  // maxRetries is set to 0 to disable the OpenAI SDK's built-in 3-attempt retry
  // loop - without this, the effective timeout is 3× the per-request value (e.g.
  // 3 × 5 min = 15 min), which we saw in practice as seemingly-frozen CI runs.
  // Application-level retries are handled by the orchestrator's own loop instead.
  const clientTimeoutMs = options.timeoutMs ?? MAX_ORCHESTRATOR_TIMEOUT_MS;
  const client = new OpenAI({
    apiKey: options.apiKey,
    baseURL,
    timeout: clientTimeoutMs,
    maxRetries: 0,
  });
  const start = Date.now();
  const estInputTokens = Math.ceil((options.systemPrompt.length + options.userMessage.length) / 4);
  const label = baseURL ? `openai-compat(${baseURL})` : 'openai';

  const labelTag = options.callLabel ? ` [${options.callLabel}]` : '';
  logRuntimeDebug(`[direct-${label}]${labelTag} Starting call: model=${modelId}, systemPrompt=${options.systemPrompt.length} chars, userMessage=${options.userMessage.length} chars, estInputTokens=~${estInputTokens}`);

  let lastError: Error | null = null;
  let lastRawJson: string | null = null;
  let includeResponseFormat = true;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      logRuntimeDebug(`[direct-${label}] Retry ${attempt + 1}/${MAX_RETRIES} for ${modelId}: ${lastError?.message?.slice(0, 200)}`);
    }
    const retryNote = attempt > 0 ? `\n\nPREVIOUS ATTEMPT FAILED JSON VALIDATION. Return ONLY valid JSON.` : '';
    let response: Awaited<ReturnType<typeof client.chat.completions.create>>;
    try {
      response = await client.chat.completions.create({
        model: modelId,
        max_tokens: options.maxTokens || 8096,
        temperature: options.temperature ?? 0,
        ...(includeResponseFormat ? { response_format: { type: 'json_object' as const } } : {}),
        messages: [
          { role: 'system', content: options.systemPrompt + retryNote },
          { role: 'user', content: options.userMessage },
        ],
      });
    } catch (err) {
      if (includeResponseFormat && shouldRetryWithoutResponseFormat(err)) {
        logRuntimeDebug(`[direct-${label}] response_format not supported by ${modelId}, retrying without it`);
        includeResponseFormat = false;
        attempt -= 1;
        continue;
      }
      throw normalizeRuntimeError(err, baseURL);
    }

    const rawText = response.choices[0]?.message?.content || '';
    const tokensUsed: TokenUsage = {
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    };
    const jsonStr = extractJson(rawText);
    try {
      const parsed = JSON.parse(jsonStr);
      const validated = schema.parse(parsed);
      const durationMs = Date.now() - start;
      logRuntimeDebug(`[direct-${label}] ✓ ${modelId} completed in ${(durationMs / 1000).toFixed(1)}s: ${tokensUsed.inputTokens} in + ${tokensUsed.outputTokens} out, attempt ${attempt + 1}/${MAX_RETRIES}`);
      return {
        data: validated,
        model: modelId,
        runtime: 'sdk',
        durationMs,
        rawResponse: rawText,
        tokensUsed,
      };
    } catch (err) {
      lastError = err as Error;
      lastRawJson = jsonStr;
      logRuntimeDebug(`[direct-${label}] ✗ ${modelId} validation failed (attempt ${attempt + 1}/${MAX_RETRIES}): ${lastError.message.slice(0, 200)}`);
    }
  }

  // AI structure repair: ask the model to fix the malformed JSON
  if (lastRawJson) {
    logRuntimeDebug(`[direct-${label}] Attempting AI structure repair for ${modelId}...`);
    try {
      const repair = buildStructureRepairPrompt(lastRawJson, formatZodErrors(lastError));
      const repairResponse = await client.chat.completions.create({
        model: modelId,
        max_tokens: options.maxTokens || 8096,
        temperature: 0,
        ...(includeResponseFormat ? { response_format: { type: 'json_object' as const } } : {}),
        messages: [
          { role: 'system', content: repair.systemPrompt },
          { role: 'user', content: repair.userMessage },
        ],
      });
      const repairText = repairResponse.choices[0]?.message?.content || '';
      const repairJson = extractJsonFromText(repairText);
      const repairResult = tryParseAndValidate(repairJson, schema);
      if ('data' in repairResult) {
        const durationMs = Date.now() - start;
        logRuntimeDebug(`[direct-${label}] ✓ AI repair succeeded for ${modelId} in ${(durationMs / 1000).toFixed(1)}s`);
        return {
          data: repairResult.data,
          model: modelId,
          runtime: 'sdk',
          durationMs,
          rawResponse: repairText,
          tokensUsed: {
            inputTokens: repairResponse.usage?.prompt_tokens ?? 0,
            outputTokens: repairResponse.usage?.completion_tokens ?? 0,
          },
        };
      }
      logRuntimeDebug(`[direct-${label}] ✗ AI repair also failed validation: ${('error' in repairResult ? repairResult.error.message : 'unknown').slice(0, 200)}`);
    } catch (repairErr) {
      logRuntimeDebug(`[direct-${label}] ✗ AI repair call failed: ${(repairErr as Error).message.slice(0, 200)}`);
    }
  }

  throw new Error(`Failed to get valid JSON after ${MAX_RETRIES} attempts + AI repair: ${lastError?.message}`);
}

function resolveOpenAICompatibleBaseUrl(transport: string, apiBaseUrl?: string): string | undefined {
  if (apiBaseUrl?.trim()) {
    return apiBaseUrl.trim();
  }

  switch (normalizeTransport(transport)) {
    case 'openrouter':
      return 'https://openrouter.ai/api/v1';
    case 'minimax':
      return 'https://api.minimax.chat/v1';
    case 'google':
    case 'gemini':
      return 'https://generativelanguage.googleapis.com/v1beta/openai';
    case 'vercel':
      return VERCEL_AI_GATEWAY_BASE_URL;
    case 'deepseek':
      return 'https://api.deepseek.com/v1';
    case 'groq':
      return 'https://api.groq.com/openai/v1';
    case 'cerebras':
      return 'https://api.cerebras.ai/v1';
    case 'together':
      return 'https://api.together.xyz/v1';
    case 'fireworks':
      return 'https://api.fireworks.ai/inference/v1';
    case 'xai':
      return 'https://api.x.ai/v1';
    case 'mistral':
      return 'https://api.mistral.ai/v1';
    case 'cohere':
      return 'https://api.cohere.com/compatibility/v1';
    case 'perplexity':
      return 'https://api.perplexity.ai';
    case 'deepinfra':
      return 'https://api.deepinfra.com/v1/openai';
    case 'ollama':
      return 'http://localhost:11434/v1';
    case 'lmstudio':
      return 'http://localhost:1234/v1';
    case 'huggingface':
      return 'https://router.huggingface.co/v1';
    case 'moonshot':
      return 'https://api.moonshot.ai/v1';
    case 'novita':
      return 'https://api.novita.ai/v3/openai';
    case 'sambanova':
      return 'https://api.sambanova.ai/v1';
    case 'nebius':
      return 'https://api.studio.nebius.ai/v1';
    default:
      return undefined;
  }
}

export class DirectAIRuntime implements IRuntime {
  async run<T>(options: RunOptions, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<RunResult<T>> {
    const { transport, modelId } = resolveModelTarget(options.model, options.transport);
    const baseURL = resolveOpenAICompatibleBaseUrl(transport, options.apiBaseUrl);

    // Prefer the configured gateway key before falling back to .env-provided auth.
    if (transport === 'vercel') {
      const apiKey = resolveVercelGatewayCredential(options.apiKey);
      if (!apiKey) {
        throw new Error(
          'Vercel AI Gateway requires a credential. Set BATEYE_LLM_MODEL_API_KEY, AI_GATEWAY_API_KEY, or VERCEL_OIDC_TOKEN.'
        );
      }
      return runWithOpenAI({ ...options, apiKey }, schema, modelId, baseURL);
    }

    switch (transport) {
      case 'azure':
        return runWithAzure(options, schema, modelId);
      case 'anthropic':
        if (!baseURL) {
          return runWithAnthropic(options, schema, modelId);
        }
        return runWithOpenAI(options, schema, modelId, baseURL);
      default:
        return runWithOpenAI(options, schema, modelId, baseURL);
    }
  }

  async listModels(provider: string, apiKey: string, apiBaseUrl?: string): Promise<string[]> {
    const normalizedProvider = normalizeTransport(provider);
    const baseURL = resolveOpenAICompatibleBaseUrl(normalizedProvider, apiBaseUrl);

    try {
      switch (normalizedProvider) {
        case 'anthropic': {
          return [
            'anthropic/claude-opus-4-6',
            'anthropic/claude-sonnet-4-6',
            'anthropic/claude-sonnet-4-5',
            'anthropic/claude-haiku-4-5-20251001',
          ];
        }
        case 'google':
        case 'gemini': {
          return [
            'google/gemini-2.5-pro-preview-03-25',
            'google/gemini-2.0-flash',
            'google/gemini-2.0-flash-lite',
            'google/gemini-1.5-pro',
            'google/gemini-1.5-flash',
          ];
        }
        case 'azure': {
          // Azure: return commonly deployed models since deployed model names vary per resource
          return [
            'azure/gpt-4o',
            'azure/gpt-4o-mini',
            'azure/gpt-4-turbo',
            'azure/o3-mini',
            'azure/o1',
          ];
        }
        case 'ollama':
        case 'lmstudio': {
          // Local providers - no API key required
          const dummyKey = normalizedProvider === 'ollama' ? 'ollama' : 'lmstudio';
          const client = new OpenAI({ apiKey: dummyKey, baseURL });
          const models = await client.models.list();
          return models.data.map(m => `${normalizedProvider}/${m.id}`).sort();
        }
        case 'openai': {
          const client = new OpenAI({ apiKey, baseURL });
          const models = await client.models.list();
          return models.data
            .filter(m => m.id.includes('gpt') || m.id.startsWith('o'))
            .map(m => `openai/${m.id}`)
            .sort();
        }
        default: {
          if (!apiKey) {
            return [];
          }
          const client = new OpenAI({ apiKey, baseURL });
          const models = await client.models.list();
          return models.data.map(m => m.id).sort();
        }
      }
    } catch (err) {
      logRuntimeDebug(`Failed to list models for ${normalizedProvider}: ${formatErrorWithCauses(err)}`);
      return [];
    }
  }

  async isAvailable(): Promise<boolean> {
    return true; // Direct runtime is always available
  }

  async runAgenticReview<T>(_options: AgenticRepositoryReviewOptions, _schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<RunResult<T>> {
    throw new Error(
      'Agentic repository review requires the OpenCode CLI runtime or BATEYE_RUNTIME=mock. '
      + 'The direct SDK runtime cannot inspect the repository before reporting findings.'
    );
  }
}
