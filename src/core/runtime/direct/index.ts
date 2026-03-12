import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { z } from 'zod';
import { IRuntime, RunOptions, RunResult, normalizeTransport, resolveModelTarget } from '../interface';

const MAX_RETRIES = 3;
const VERCEL_AI_GATEWAY_BASE_URL = 'https://ai-gateway.vercel.sh/v1';

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

async function runWithAnthropic<T>(
  options: RunOptions,
  schema: z.ZodSchema<T>,
  modelId: string
): Promise<RunResult<T>> {
  const client = new Anthropic({ apiKey: options.apiKey });
  const start = Date.now();

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
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
      };
    } catch (err) {
      lastError = err as Error;
    }
  }
  throw new Error(`Failed to get valid JSON after ${MAX_RETRIES} attempts: ${lastError?.message}`);
}

async function runWithOpenAI<T>(
  options: RunOptions,
  schema: z.ZodSchema<T>,
  modelId: string,
  baseURL?: string
): Promise<RunResult<T>> {
  const client = new OpenAI({
    apiKey: options.apiKey,
    baseURL,
  });
  const start = Date.now();

  let lastError: Error | null = null;
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
      };
    } catch (err) {
      lastError = err as Error;
    }
  }
  throw new Error(`Failed to get valid JSON after ${MAX_RETRIES} attempts: ${lastError?.message}`);
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
      return 'https://generativelanguage.googleapis.com/v1beta/openai';
    case 'vercel':
      return VERCEL_AI_GATEWAY_BASE_URL;
    default:
      return undefined;
  }
}

export class DirectAIRuntime implements IRuntime {
  async run<T>(options: RunOptions, schema: z.ZodSchema<T>): Promise<RunResult<T>> {
    const { transport, modelId } = resolveModelTarget(options.model, options.transport);
    const baseURL = resolveOpenAICompatibleBaseUrl(transport, options.apiBaseUrl);

    switch (transport) {
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
          // Anthropic doesn't have a list models API, return known models
          return [
            'anthropic/claude-opus-4-6',
            'anthropic/claude-sonnet-4-6',
            'anthropic/claude-sonnet-4-5',
            'anthropic/claude-haiku-4-5-20251001',
          ];
        }
        case 'openai': {
          const client = new OpenAI({ apiKey, baseURL });
          const models = await client.models.list();
          return models.data
            .filter(m => m.id.includes('gpt') || m.id.startsWith('o'))
            .map(m => `openai/${m.id}`)
            .sort();
        }
        default:
          if (!apiKey) {
            return [];
          }

          const client = new OpenAI({ apiKey, baseURL });
          const models = await client.models.list();
          return models.data
            .map(model => model.id)
            .sort();
      }
    } catch {
      return [];
    }
  }

  async isAvailable(): Promise<boolean> {
    return true; // Direct runtime is always available
  }
}
