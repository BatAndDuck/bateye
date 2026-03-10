import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { z } from 'zod';
import { IRuntime, RunOptions, RunResult, parseProviderAndModel } from '../interface';

const MAX_RETRIES = 3;

function extractJson(text: string): string {
  // Try to extract JSON from markdown code blocks
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();
  // Try to find raw JSON object/array
  const objMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (objMatch) return objMatch[1];
  return text.trim();
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
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const retryNote = attempt > 0 ? `\n\nPREVIOUS ATTEMPT FAILED JSON VALIDATION. Return ONLY valid JSON.` : '';
    const response = await client.chat.completions.create({
      model: modelId,
      max_tokens: options.maxTokens || 8096,
      temperature: options.temperature ?? 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: options.systemPrompt + retryNote },
        { role: 'user', content: options.userMessage },
      ],
    });

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

export class DirectAIRuntime implements IRuntime {
  async run<T>(options: RunOptions, schema: z.ZodSchema<T>): Promise<RunResult<T>> {
    const { provider, modelId } = parseProviderAndModel(options.model);

    switch (provider) {
      case 'anthropic':
        return runWithAnthropic(options, schema, modelId);
      case 'openai':
        return runWithOpenAI(options, schema, modelId);
      case 'openrouter':
        return runWithOpenAI(options, schema, modelId, 'https://openrouter.ai/api/v1');
      case 'minimax':
        return runWithOpenAI(options, schema, modelId, 'https://api.minimax.chat/v1');
      case 'google':
        // Google uses OpenAI-compatible API
        return runWithOpenAI(options, schema, modelId, 'https://generativelanguage.googleapis.com/v1beta/openai');
      default:
        // Fall back to OpenAI-compatible
        return runWithOpenAI(options, schema, modelId);
    }
  }

  async listModels(provider: string, apiKey: string): Promise<string[]> {
    try {
      switch (provider.toLowerCase()) {
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
          const client = new OpenAI({ apiKey });
          const models = await client.models.list();
          return models.data
            .filter(m => m.id.includes('gpt') || m.id.startsWith('o'))
            .map(m => `openai/${m.id}`)
            .sort();
        }
        default:
          return [];
      }
    } catch {
      return [];
    }
  }

  async isAvailable(): Promise<boolean> {
    return true; // Direct runtime is always available
  }
}
