import { IRuntime } from './interface';
import { DirectAIRuntime } from './direct/index';
import { CodebiteAgentRuntime } from './codebite/index';
import { MockRuntime } from '../../features/shared/runtime/mock-runtime';

export type RuntimePreference = 'direct' | 'codebite' | 'mock' | 'auto';

const CODEBITE_RUNTIME_HINT =
  'Install BatEye with its dependencies (`npm install bateye`, `npm i -g bateye`, or `npm ci`).';

let runtimeInstance: IRuntime | null = null;
let prReviewRuntimeInstance: IRuntime | null = null;
let auditRuntimeInstance: IRuntime | null = null;
let structuredRuntimeInstance: IRuntime | null = null;

export async function createRuntime(preference: RuntimePreference = 'auto'): Promise<IRuntime> {
  const effectivePreference = preference === 'auto' && process.env.BATEYE_RUNTIME === 'mock'
    ? 'mock'
    : preference;

  if (effectivePreference === 'mock') {
    return new MockRuntime();
  }

  if (effectivePreference === 'codebite') {
    const runtime = new CodebiteAgentRuntime();
    if (await runtime.isAvailable()) return runtime;
    throw new Error(`Codebite runtime is not available. ${CODEBITE_RUNTIME_HINT}`);
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
  if (process.env.BATEYE_RUNTIME === 'mock') {
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
  if (process.env.BATEYE_RUNTIME === 'mock') {
    return new MockRuntime();
  }

  if (process.env.BATEYE_RUNTIME === 'direct') {
    throw new Error(
      `Agentic ${modeLabel} cannot use BATEYE_RUNTIME=direct. `
      + 'Use the Codebite runtime or BATEYE_RUNTIME=mock.'
    );
  }

  const runtime = new CodebiteAgentRuntime();
  if (await runtime.isAvailable()) {
    return runtime;
  }

  throw new Error(
    `Agentic ${modeLabel} requires the Codebite runtime or BATEYE_RUNTIME=mock. `
    + CODEBITE_RUNTIME_HINT
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
