import * as fs from 'fs';
import * as path from 'path';
import { RunOptions, normalizeTransport, resolveModelTarget } from '../interface';
import {
  resolveOpenAICompatibleBaseUrl,
  resolveOpenCodeModelTarget,
} from '../provider-routing';

export interface OpenCodeInvocation {
  command: string;
  args: string[];
  source: 'bundled' | 'path';
}

interface PackageJsonWithBin {
  bin?: string | Record<string, string>;
}

export const OPEN_CODE_PROMPT_ATTACHMENT_MESSAGE =
  'Read the attached BatEye prompt file and follow it exactly. '
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
  const modelArg = options.model?.trim();

  if (fullPrompt.length <= MAX_INLINE_OPEN_CODE_PROMPT_CHARS) {
    if (modelArg) {
      args.push('--model', modelArg);
    }
    args.push('--', fullPrompt);
    return args;
  }

  args.push(OPEN_CODE_PROMPT_ATTACHMENT_MESSAGE);
  if (modelArg) {
    args.push('--model', modelArg);
  }
  args.push('--file', promptFile);

  return args;
}

export function buildOpenCodeEnvironment(
  baseEnv: NodeJS.ProcessEnv,
  options: Pick<RunOptions, 'apiKey' | 'apiBaseUrl' | 'model' | 'transport'>,
  xdgDataHome?: string,
): NodeJS.ProcessEnv {
  const env = { ...baseEnv };
  const originalTarget = resolveModelTarget(options.model, options.transport);
  const effectiveTarget = resolveOpenCodeModelTarget(options.model, options.transport, options.apiBaseUrl);
  const originalTransport = normalizeTransport(originalTarget.transport);
  const normalizedTransport = normalizeTransport(effectiveTarget.transport);

  if (xdgDataHome) {
    env.XDG_DATA_HOME = xdgDataHome;
  }

  if (normalizedTransport === 'anthropic' && !env.ANTHROPIC_API_KEY) {
    env.ANTHROPIC_API_KEY = options.apiKey;
  } else if ((normalizedTransport === 'google' || normalizedTransport === 'gemini') && !env.GOOGLE_API_KEY) {
    env.GOOGLE_API_KEY = options.apiKey;
    env.GEMINI_API_KEY = env.GEMINI_API_KEY || options.apiKey;
    // OpenCode's @ai-sdk/google expects GOOGLE_GENERATIVE_AI_API_KEY
    env.GOOGLE_GENERATIVE_AI_API_KEY = env.GOOGLE_GENERATIVE_AI_API_KEY || options.apiKey;
  } else if (!env.OPENAI_API_KEY) {
    env.OPENAI_API_KEY = options.apiKey;
  }

  const baseUrl = resolveOpenAICompatibleBaseUrl(normalizedTransport, options.apiBaseUrl);
  if (baseUrl && !env.OPENAI_BASE_URL) {
    env.OPENAI_BASE_URL = baseUrl;
  }

  if (originalTransport === 'vercel') {
    env.AI_GATEWAY_API_KEY = env.AI_GATEWAY_API_KEY || options.apiKey;
    env.OPENAI_API_KEY = env.OPENAI_API_KEY || options.apiKey;
    env.OPENAI_BASE_URL = env.OPENAI_BASE_URL || baseUrl;
  }

  return env;
}

function findBundledOpenCodePackageJson(): string | null {
  try {
    return require.resolve('opencode-ai/package.json');
  } catch {
    return null;
  }
}
