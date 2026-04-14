import { createGateway } from 'ai';
import { normalizeTransport } from '../interface';
import {
  fetchOpenAICompatibleModels,
  MISTRAL_API_BASE_URL,
  OPENAI_API_BASE_URL,
  resolveVercelGatewayCredential,
  VERCEL_AI_GATEWAY_BASE_URL,
} from '../provider-routing';

export const SUPPORTED_CODEBITE_PROVIDERS = [
  'openai',
  'anthropic',
  'google',
  'mistral',
  'vercel',
] as const;

export type CodebiteProvider = (typeof SUPPORTED_CODEBITE_PROVIDERS)[number];

const ANTHROPIC_API_VERSION = '2023-06-01';
const FETCH_TIMEOUT_MS = 10_000;

export function normalizeCodebiteProvider(provider: string): CodebiteProvider | null {
  switch (normalizeTransport(provider)) {
    case 'openai':
    case 'anthropic':
    case 'google':
    case 'mistral':
    case 'vercel':
      return normalizeTransport(provider) as CodebiteProvider;
    case 'gemini':
      return 'google';
    default:
      return null;
  }
}

export function formatSupportedCodebiteProviders(): string {
  return SUPPORTED_CODEBITE_PROVIDERS.join(', ');
}

export async function fetchCodebiteProviderModels(
  provider: string,
  apiKey: string,
  apiBaseUrl?: string,
  cwd?: string,
): Promise<string[]> {
  const normalizedProvider = normalizeCodebiteProvider(provider);
  if (!normalizedProvider) {
    return [];
  }

  switch (normalizedProvider) {
    case 'openai':
      return fetchOpenAICompatibleModels(apiKey, apiBaseUrl?.trim() || OPENAI_API_BASE_URL);
    case 'mistral':
      return fetchOpenAICompatibleModels(
        apiKey,
        apiBaseUrl?.trim() || MISTRAL_API_BASE_URL,
      );
    case 'vercel': {
      const credential = resolveVercelGatewayCredential(apiKey, cwd) || apiKey;
      return fetchVercelGatewayModels(credential, apiBaseUrl?.trim() || VERCEL_AI_GATEWAY_BASE_URL);
    }
    case 'anthropic':
      return fetchAnthropicModels(apiKey);
    case 'google':
      return fetchGoogleModels(apiKey);
    default:
      return [];
  }
}

async function fetchVercelGatewayModels(apiKey: string, baseURL: string): Promise<string[]> {
  try {
    const gateway = createGateway({ apiKey, baseURL });
    const response = await gateway.getAvailableModels();
    return (response.models ?? [])
      .map(model => model.id?.trim())
      .filter((id): id is string => Boolean(id))
      .sort();
  } catch {
    return [];
  }
}

async function fetchAnthropicModels(apiKey: string): Promise<string[]> {
  try {
    const response = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_API_VERSION,
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      return [];
    }

    const body = await response.json() as { data?: Array<{ id?: string }> };
    return (body.data ?? [])
      .map(model => model.id?.trim())
      .filter((id): id is string => Boolean(id))
      .sort();
  } catch {
    return [];
  }
}

async function fetchGoogleModels(apiKey: string): Promise<string[]> {
  try {
    const url = new URL('https://generativelanguage.googleapis.com/v1beta/models');
    url.searchParams.set('key', apiKey);

    const response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      return [];
    }

    const body = await response.json() as { models?: Array<{ name?: string }> };
    return (body.models ?? [])
      .map(model => model.name?.replace(/^models\//, '').trim())
      .filter((id): id is string => Boolean(id))
      .sort();
  } catch {
    return [];
  }
}
