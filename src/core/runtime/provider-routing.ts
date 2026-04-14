import * as fs from 'fs';
import * as path from 'path';

export const VERCEL_AI_GATEWAY_BASE_URL = 'https://ai-gateway.vercel.sh/v3/ai';
export const OPENAI_API_BASE_URL = 'https://api.openai.com/v1';
export const MISTRAL_API_BASE_URL = 'https://api.mistral.ai/v1';

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
    // Only allow http/https — reject non-HTTP schemes defensively.
    if (!/^https?:\/\//i.test(cleanBase)) {
      return [];
    }
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
