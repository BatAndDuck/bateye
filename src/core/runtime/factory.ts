import { IRuntime } from './interface';
import { DirectAIRuntime } from './direct/index';
import { OpenCodeCLIRuntime } from './opencode-cli/index';
import { MockRuntime } from '../../features/shared/runtime/mock-runtime';

export type RuntimePreference = 'direct' | 'opencode-cli' | 'mock' | 'auto';

const OPEN_CODE_RUNTIME_HINT =
  'Install CodeOwl with its dependencies (`npm install codeowl`, `npm i -g codeowl`, or `npm ci`) '
  + 'or make `opencode` available on PATH.';

let runtimeInstance: IRuntime | null = null;
let prReviewRuntimeInstance: IRuntime | null = null;
let auditRuntimeInstance: IRuntime | null = null;
let structuredRuntimeInstance: IRuntime | null = null;

export async function createRuntime(preference: RuntimePreference = 'auto'): Promise<IRuntime> {
  const effectivePreference = preference === 'auto' && process.env.CODEOWL_RUNTIME === 'mock'
    ? 'mock'
    : preference;

  if (effectivePreference === 'mock') {
    return new MockRuntime();
  }

  if (effectivePreference === 'opencode-cli') {
    const cli = new OpenCodeCLIRuntime();
    if (await cli.isAvailable()) return cli;
    throw new Error(`OpenCode CLI is not available. ${OPEN_CODE_RUNTIME_HINT}`);
  }

  if (effectivePreference === 'direct') {
    return new DirectAIRuntime();
  }

  return new DirectAIRuntime();
}

export async function getRuntime(): Promise<IRuntime> {
  if (!runtimeInstance) {
    runtimeInstance = await createRuntime('auto');
  }
  return runtimeInstance;
}

export async function createStructuredRuntime(): Promise<IRuntime> {
  if (process.env.CODEOWL_RUNTIME === 'mock') {
    return new MockRuntime();
  }

  return new DirectAIRuntime();
}

export async function createPRReviewRuntime(): Promise<IRuntime> {
  return createAgenticRuntime('PR review');
}

export async function createAuditRuntime(): Promise<IRuntime> {
  return createAgenticRuntime('audit');
}

async function createAgenticRuntime(modeLabel: string): Promise<IRuntime> {
  if (process.env.CODEOWL_RUNTIME === 'mock') {
    return new MockRuntime();
  }

  if (process.env.CODEOWL_RUNTIME === 'direct') {
    throw new Error(
      `Agentic ${modeLabel} cannot use CODEOWL_RUNTIME=direct. `
      + 'Use the OpenCode CLI runtime or CODEOWL_RUNTIME=mock.'
    );
  }

  const cli = new OpenCodeCLIRuntime();
  if (await cli.isAvailable()) {
    return cli;
  }

  throw new Error(
    `Agentic ${modeLabel} requires the OpenCode CLI runtime or CODEOWL_RUNTIME=mock. `
    + OPEN_CODE_RUNTIME_HINT
  );
}

export async function getPRReviewRuntime(): Promise<IRuntime> {
  if (!prReviewRuntimeInstance) {
    prReviewRuntimeInstance = await createPRReviewRuntime();
  }
  return prReviewRuntimeInstance;
}

export async function getAuditRuntime(): Promise<IRuntime> {
  if (!auditRuntimeInstance) {
    auditRuntimeInstance = await createAuditRuntime();
  }
  return auditRuntimeInstance;
}

export async function getStructuredRuntime(): Promise<IRuntime> {
  if (!structuredRuntimeInstance) {
    structuredRuntimeInstance = await createStructuredRuntime();
  }
  return structuredRuntimeInstance;
}

export function resetRuntime(): void {
  runtimeInstance = null;
  prReviewRuntimeInstance = null;
  auditRuntimeInstance = null;
  structuredRuntimeInstance = null;
}
