import * as fs from 'fs';
import * as path from 'path';
import { normalizeTransport, resolveModelTarget } from './interface';

export const VERCEL_AI_GATEWAY_BASE_URL = 'https://ai-gateway.vercel.sh/v1';
export const OPENAI_API_BASE_URL = 'https://api.openai.com/v1';

function resolveDotEnvValue(name: string, cwd = process.cwd()): string | undefined {
  const fromEnv = process.env[name]?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  let dir = cwd;
  for (let i = 0; i < 5; i++) {
    const envFile = path.join(dir, '.env');
    if (fs.existsSync(envFile)) {
      const line = fs.readFileSync(envFile, 'utf-8')
        .split('\n')
        .find(candidate => candidate.startsWith(`${name}=`));
      if (line) {
        return line.slice(`${name}=`.length).trim().replace(/^["']|["']$/g, '');
      }
    }

    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
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
  return configuredApiKey?.trim() || resolveVercelGatewayApiKey(cwd) || resolveVercelOidcToken(cwd);
}

export function resolveOpenAICompatibleBaseUrl(transport: string, apiBaseUrl?: string): string | undefined {
  if (apiBaseUrl?.trim()) {
    return apiBaseUrl.trim();
  }

  switch (normalizeTransport(transport)) {
    case 'openai':
      return OPENAI_API_BASE_URL;
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
    case 'litellm':
      return 'http://localhost:4000/v1';
    default:
      return undefined;
  }
}

/**
 * Fetches the list of model IDs from an OpenAI-compatible /v1/models endpoint.
 * Returns an empty array on any failure (network error, auth, etc.) so callers
 * can degrade gracefully.
 */
export async function fetchOpenAICompatibleModels(
  apiKey: string,
  baseUrl: string,
): Promise<string[]> {
  try {
    const cleanBase = baseUrl.replace(/\/+$/, '');
    const response = await fetch(`${cleanBase}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return [];
    }
    const body = await response.json() as { data?: Array<{ id: string }> };
    return (body.data ?? []).map(m => m.id).filter(Boolean).sort();
  } catch {
    return [];
  }
}

export function resolveOpenAICompatibleModelId(
  modelString: string,
  resolvedModelId: string,
  apiBaseUrl?: string,
): string {
  if (apiBaseUrl?.trim() && modelString.includes('/')) {
    return modelString.trim();
  }

  return resolvedModelId;
}

/**
 * Transports that OpenCode handles natively through dedicated provider integrations.
 * All other OpenAI-compatible transports (litellm, groq, ollama, etc.) must be coerced
 * to 'openai' so OpenCode routes through OPENAI_BASE_URL (set by buildOpenCodeEnvironment).
 */
const OPENCODE_NATIVE_TRANSPORTS = new Set(['anthropic', 'openai', 'google', 'gemini', 'azure', 'vercel']);

export function resolveOpenCodeModelTarget(
  modelString: string,
  transport?: string,
  apiBaseUrl?: string,
): { transport: string; modelId: string } {
  const target = resolveModelTarget(modelString, transport);
  const normalizedTransport = normalizeTransport(target.transport);

  if (normalizedTransport === 'azure' || normalizedTransport === 'vercel') {
    return target;
  }

  if (apiBaseUrl?.trim()) {
    return {
      transport: 'openai',
      modelId: resolveOpenAICompatibleModelId(modelString, target.modelId, apiBaseUrl),
    };
  }

  // Providers not natively supported by OpenCode must use 'openai' transport so OpenCode
  // routes through OPENAI_BASE_URL (set to the provider's endpoint by buildOpenCodeEnvironment).
  if (!OPENCODE_NATIVE_TRANSPORTS.has(normalizedTransport)) {
    return {
      transport: 'openai',
      modelId: target.modelId,
    };
  }

  return target;
}
