import * as fs from 'fs';
import * as path from 'path';
import { RunOptions, normalizeTransport, resolveModelTarget } from '../interface';

export interface OpenCodeInvocation {
  command: string;
  args: string[];
  source: 'bundled' | 'path';
}

interface PackageJsonWithBin {
  bin?: string | Record<string, string>;
}

const VERCEL_AI_GATEWAY_BASE_URL = 'https://ai-gateway.vercel.sh/v1';

export const OPEN_CODE_PROMPT_ATTACHMENT_MESSAGE =
  'Read the attached CodeOwl prompt file and follow it exactly. '
  + 'Investigate the repository as needed and return only the requested JSON.';
export const MAX_INLINE_OPEN_CODE_PROMPT_CHARS = 16_000;

export function resolveBundledOpenCodeInvocation(
  packageJsonPath: string | null = findBundledOpenCodePackageJson(),
): OpenCodeInvocation | null {
  if (!packageJsonPath) {
    return null;
  }

  const packageDir = path.dirname(packageJsonPath);
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as PackageJsonWithBin;
  const binConfig = packageJson.bin;
  const binRelativePath = typeof binConfig === 'string'
    ? binConfig
    : binConfig?.opencode ?? Object.values(binConfig ?? {})[0];

  if (!binRelativePath) {
    return null;
  }

  const binPath = path.resolve(packageDir, binRelativePath);
  if (!fs.existsSync(binPath)) {
    return null;
  }

  return {
    command: process.execPath,
    args: [binPath],
    source: 'bundled',
  };
}

export function resolveOpenCodeInvocation(): OpenCodeInvocation {
  return resolveBundledOpenCodeInvocation() ?? {
    command: 'opencode',
    args: [],
    source: 'path',
  };
}

export function buildOpenCodeRunArguments(
  invocation: OpenCodeInvocation,
  options: Pick<RunOptions, 'model'>,
  fullPrompt: string,
  promptFile: string,
): string[] {
  const args = [...invocation.args, 'run'];

  if (options.model?.trim()) {
    args.push('--model', options.model.trim());
  }

  if (fullPrompt.length <= MAX_INLINE_OPEN_CODE_PROMPT_CHARS) {
    args.push('--', fullPrompt);
    return args;
  }

  args.push('--file', promptFile);

  // `--file` is an array argument in OpenCode, so `--` is required to terminate
  // flag parsing before the positional message.
  args.push('--', OPEN_CODE_PROMPT_ATTACHMENT_MESSAGE);

  return args;
}

export function buildOpenCodeEnvironment(
  baseEnv: NodeJS.ProcessEnv,
  options: Pick<RunOptions, 'apiKey' | 'apiBaseUrl' | 'model' | 'transport'>,
  xdgDataHome?: string,
): NodeJS.ProcessEnv {
  const env = { ...baseEnv };
  const { transport } = resolveModelTarget(options.model, options.transport);
  const normalizedTransport = normalizeTransport(transport);

  if (xdgDataHome) {
    env.XDG_DATA_HOME = xdgDataHome;
  }

  if (normalizedTransport === 'anthropic' && !env.ANTHROPIC_API_KEY) {
    env.ANTHROPIC_API_KEY = options.apiKey;
  } else if ((normalizedTransport === 'google' || normalizedTransport === 'gemini') && !env.GOOGLE_API_KEY) {
    env.GOOGLE_API_KEY = options.apiKey;
    env.GEMINI_API_KEY = env.GEMINI_API_KEY || options.apiKey;
  } else if (!env.OPENAI_API_KEY) {
    env.OPENAI_API_KEY = options.apiKey;
  }

  const baseUrl = resolveOpenAICompatibleBaseUrl(normalizedTransport, options.apiBaseUrl);
  if (baseUrl && !env.OPENAI_BASE_URL) {
    env.OPENAI_BASE_URL = baseUrl;
  }

  if (normalizedTransport === 'vercel') {
    env.AI_GATEWAY_API_KEY = env.AI_GATEWAY_API_KEY || options.apiKey;
    env.OPENAI_API_KEY = env.OPENAI_API_KEY || options.apiKey;
    env.OPENAI_BASE_URL = env.OPENAI_BASE_URL || VERCEL_AI_GATEWAY_BASE_URL;
  }

  return env;
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

function findBundledOpenCodePackageJson(): string | null {
  try {
    return require.resolve('opencode-ai/package.json');
  } catch {
    return null;
  }
}
